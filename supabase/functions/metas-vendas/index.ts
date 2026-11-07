// Metas da semana e ranking dos consultores, mostrados no topo do funil.
// Leads novos e sessões agendadas vêm do próprio CRM; sessões realizadas, vendas e o ranking vêm do
// Registro de Sessões 1:1 do Essência Plat (venda_sessoes), que é onde todas as sessões ficam registradas.
// Secret: PLAT_SERVICE_KEY (chave de serviço do projeto do Plat)
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } })
const PLAT_URL = Deno.env.get('PLAT_URL') ?? 'https://yahjhvnubmmfvxbjxmoo.supabase.co'
function platClient() {
  const key = Deno.env.get('PLAT_SERVICE_KEY')
  return key ? createClient(PLAT_URL, key, { auth: { persistSession: false } }) : null
}

// Datas no horário de Brasília (UTC-3, sem horário de verão)
const spHoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const addDias = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const inicioSemana = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); const w = (d.getUTCDay() + 6) % 7; return addDias(iso, -w) }
const meiaNoiteSP = (iso: string) => new Date(iso + 'T03:00:00Z').toISOString()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { data: me } = await admin.from('profiles').select('active').eq('id', user.id).single()
  if (!me?.active) return json({ error: 'Usuário inativo' }, 403)

  const hoje = spHoje()
  const semIni = inicioSemana(hoje), semFim = addDias(semIni, 7)
  const mesIni = hoje.slice(0, 8) + '01'
  const prox = new Date(mesIni + 'T12:00:00Z'); prox.setUTCMonth(prox.getUTCMonth() + 1)
  const mesFim = prox.toISOString().slice(0, 10)

  // Leads novos da semana (funil da Mentoria, sem os importados do CRM antigo e sem testes)
  const { data: pipe } = await admin.from('pipelines').select('id').eq('name', 'Mentoria').maybeSingle()
  let qLeads = admin.from('deals').select('id, title, contact:contacts(source)').gte('created_at', meiaNoiteSP(semIni)).lt('created_at', meiaNoiteSP(semFim))
  if (pipe?.id) qLeads = qLeads.eq('pipeline_id', pipe.id)
  const { data: leadsRows } = await qLeads
  const leads = (leadsRows ?? []).filter((d: any) => !/teste/i.test(d.title || '') && d.contact?.source !== 'CRM antigo').length

  // Sessões agendadas na semana: cards que entraram em "Reunião agendada" nesta semana
  const { data: stAg } = await admin.from('stages').select('id').eq('name', 'Reunião agendada')
  const { data: hist } = await admin.from('deal_stage_history').select('deal_id').in('to_stage_id', (stAg ?? []).map((s: any) => s.id))
    .gte('changed_at', meiaNoiteSP(semIni)).lt('changed_at', meiaNoiteSP(semFim))
  const agendadas = new Set((hist ?? []).map((h: any) => h.deal_id)).size

  // Registro de Sessões 1:1 (Plat): realizadas e vendas da semana e do mês, e ranking do mês
  const plat = platClient()
  let semana = { realizadas: 0, vendas: 0 }, mes = { realizadas: 0, vendas: 0, valor: 0, cash: 0, upsells: 0, valor_upsell: 0, cash_upsell: 0 }
  let ranking: any[] = [], ranking_upsell: any[] = []
  if (plat) {
    const { data: vs } = await plat.from('venda_sessoes').select('id, data_sessao, vendedor, presenca, resultado, upsell, valor_numerico, lead_nome')
      .gte('data_sessao', mesIni < semIni ? mesIni : semIni).lt('data_sessao', mesFim > semFim ? mesFim : semFim)
    // Upsell marcado no card do CRM também conta como upsell, mesmo que o Plat ainda não tenha sido atualizado.
    const idsVenda = (vs ?? []).filter((r: any) => r.resultado === 'Vendido' && r.data_sessao >= mesIni && r.data_sessao < mesFim).map((r: any) => r.id)
    const upsellCRM = new Set<string>()
    if (idsVenda.length) {
      const { data: ds } = await admin.from('deals').select('plat_sessao_id, sessao_registro').in('plat_sessao_id', idsVenda)
      for (const d of ds ?? []) if ((d as any).sessao_registro?.upsell === true) upsellCRM.add((d as any).plat_sessao_id)
    }
    // Cash collect do mês (caixa_lancamentos): Pix na hora + cartão por link (D+1, já sem a taxa da InfinitePay), inclui upsell.
    // Upsell/renovação lançado no caixa também tira a sessão das vendas novas (pelo nome do lead), se o Plat ainda não marcou.
    const { data: cx } = await admin.from('caixa_lancamentos').select('vendedor, tipo, liquido, lead, valor_contrato').gte('data', mesIni).lt('data', mesFim)
    const sem = (t: string) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/).slice(0, 2).join(' ')
    const upsellNome = new Set((cx ?? []).filter((l: any) => l.tipo === 'upsell' && l.lead).map((l: any) => sem(l.lead)))
    const quem = (v: string) => { const t = String(v || '').trim(); return /^carmem e diego$/i.test(t) ? 'Diego' : t }
    const novo = (n: string) => ({ nome: n, sessoes: 0, noshow: 0, vendas: 0, valor: 0, cash: 0, upsells: 0, valor_upsell: 0, cash_upsell: 0 })
    // os três consultores sempre aparecem (vendas novas e upsell/renovação), mesmo zerados
    const por: Record<string, any> = { Adriana: novo('Adriana'), Carmem: novo('Carmem'), Diego: novo('Diego') }
    for (const r of vs ?? []) {
      const up = !!r.upsell || upsellCRM.has(r.id) || (r.resultado === 'Vendido' && upsellNome.has(sem(r.lead_nome)))
      const show = r.presenca === 'Show', venda = r.resultado === 'Vendido' && !up
      if (r.data_sessao >= semIni && r.data_sessao < semFim) { if (show) semana.realizadas++; if (venda) semana.vendas++ }
      if (r.data_sessao >= mesIni && r.data_sessao < mesFim) {
        if (show) mes.realizadas++
        if (venda) { mes.vendas++; mes.valor += Number(r.valor_numerico) || 0 }
        const n = quem(r.vendedor); if (!n || /viviane/i.test(n)) continue
        const p = por[n] ??= novo(n)
        if (show) p.sessoes++; else if (r.presenca === 'No-show') p.noshow++
        if (venda) { p.vendas++; p.valor += Number(r.valor_numerico) || 0 }
      }
    }
    for (const l of cx ?? []) {
      const n = quem((l as any).vendedor); if (!n || /viviane/i.test(n)) continue
      const p = por[n] ??= novo(n)
      const v = Number((l as any).liquido) || 0
      if ((l as any).tipo === 'upsell') {
        p.cash_upsell += v; mes.cash_upsell += v
        if ((l as any).valor_contrato != null) { p.upsells++; p.valor_upsell += Number((l as any).valor_contrato) || 0; mes.upsells++; mes.valor_upsell += Number((l as any).valor_contrato) || 0 }
      } else { p.cash += v; mes.cash += v }
    }
    ranking = Object.values(por).map((p: any) => ({ ...p, conversao: p.sessoes ? Math.round(p.vendas / p.sessoes * 1000) / 10 : 0 }))
      .sort((a: any, b: any) => b.vendas - a.vendas || b.valor - a.valor || b.conversao - a.conversao || b.sessoes - a.sessoes)
    ranking_upsell = Object.values(por).map((p: any) => ({ nome: p.nome, upsells: p.upsells, valor: p.valor_upsell, cash: p.cash_upsell }))
      .sort((a: any, b: any) => b.valor - a.valor || b.cash - a.cash || b.upsells - a.upsells)
  }
  return json({ hoje, semana_ini: semIni, mes_ini: mesIni, leads, agendadas, semana, mes, ranking, ranking_upsell, plat: !!plat })
})
