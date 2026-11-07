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
  let semana = { realizadas: 0, vendas: 0 }, mes = { realizadas: 0, vendas: 0, valor: 0 }
  let ranking: any[] = []
  if (plat) {
    const { data: vs } = await plat.from('venda_sessoes').select('data_sessao, vendedor, presenca, resultado, upsell, valor_numerico')
      .gte('data_sessao', mesIni < semIni ? mesIni : semIni).lt('data_sessao', mesFim > semFim ? mesFim : semFim)
    const quem = (v: string) => { const t = String(v || '').trim(); return /^carmem e diego$/i.test(t) ? 'Diego' : t }
    const por: Record<string, any> = {}
    for (const r of vs ?? []) {
      const show = r.presenca === 'Show', venda = r.resultado === 'Vendido' && !r.upsell
      if (r.data_sessao >= semIni && r.data_sessao < semFim) { if (show) semana.realizadas++; if (venda) semana.vendas++ }
      if (r.data_sessao >= mesIni && r.data_sessao < mesFim) {
        if (show) mes.realizadas++
        if (venda) { mes.vendas++; mes.valor += Number(r.valor_numerico) || 0 }
        const n = quem(r.vendedor); if (!n || /viviane/i.test(n)) continue
        const p = por[n] ??= { nome: n, sessoes: 0, noshow: 0, vendas: 0, upsells: 0, valor: 0 }
        if (show) p.sessoes++; else if (r.presenca === 'No-show') p.noshow++
        if (venda) { p.vendas++; p.valor += Number(r.valor_numerico) || 0 }
        else if (r.resultado === 'Vendido' && r.upsell) p.upsells++
      }
    }
    ranking = Object.values(por).map((p: any) => ({ ...p, conversao: p.sessoes ? Math.round(p.vendas / p.sessoes * 1000) / 10 : 0 }))
      .sort((a: any, b: any) => b.vendas - a.vendas || b.valor - a.valor || b.conversao - a.conversao || b.sessoes - a.sessoes)
  }
  return json({ hoje, semana_ini: semIni, mes_ini: mesIni, leads, agendadas, semana, mes, ranking, plat: !!plat })
})
