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
const dias = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000))
const maxD = (a: string, b: string) => (a > b ? a : b), minD = (a: string, b: string) => (a < b ? a : b)

// Metas do MÊS para chegar às 17 vendas novas: 29% dos leads agendam, 87% comparecem, 27,5% das sessões viram venda.
// 17 vendas ÷ 27,5% = 62 sessões realizadas ÷ 87% = 71 agendadas ÷ 29% = 245 leads.
const META_MES = { leads: 245, agendadas: 71, realizadas: 62, vendas: 17 }
// Meta da semana = o que falta da meta do mês × (dias desta semana ÷ dias que restam do mês a partir desta semana).
// O que faltou numa semana passa para as seguintes, para fechar a meta no fim do mês.
const metaSemana = (metaMes: number, feitoAntes: number, diasSemana: number, diasRestantes: number) =>
  Math.max(0, Math.ceil(Math.max(0, metaMes - feitoAntes) * (diasRestantes ? diasSemana / diasRestantes : 1)))


// Objeções registradas pelos consultores (Objeção 1 e 2 do Registro de Sessões), agrupadas por tipo.
// Cada objeção escrita vai para um tipo: primeiro pelo rótulo do começo ("Financeira: ..."), depois pelas palavras do texto.
const TIPOS_OBJECAO: [string, RegExp][] = [
  ['Interrompeu ou saiu da sessão', /pediu (pra|para) parar|saiu antes|saindo antes|sem bateria|pediu (pra|para) remarcar|precisava atender|horário agendado|iria continuar|n[aã]o retornou/],
  ['Chegou sem saber do que era a sessão', /sem saber|n[aã]o sabia (direito )?(que|o que|do que)|de gra[cç]a|gratuit|enganad|n[aã]o (foi )?informad/],
  ['Formato da mentoria não se encaixa', /1:1|grande escala|atender empresas|formato|n[aã]o deseja realizar atendimentos/],
  ['Lead sem perfil / só curiosidade', /curiosidade|n[aã]o se engajou|n[aã]o quer atuar|desempregad|n[aã]o concluiu|leiga|(pra|para) conhecer a mentoria|conhecer .{0,20}valores/],
  // o consultor escreveu a dor do lead no lugar da objeção: ponto de treino do registro
  ['Registrou a dor, não a objeção', /^enf[.:]|\bdor(es)?\b|dores|quer aprender|precisa de ajuda|quer ter tempo/],
  ['Precisa consultar outra pessoa', /marido|esposo|esposa|fam[ií]lia|colegas|s[oó]cio|conversar com|falar com/],
  ['Experiência ruim com outra mentoria', /outra (mentoria|institui)|mentoria atual|j[aá] investiu|descren|entrega insatisf/],
  ['Não vê valor / não é o que precisa', /n[aã]o vale|n[aã]o [eé] o que (ela )?precisa|caro demais|n[aã]o acredita na (mentoria|proposta)/],
  ['Financeira', /financ|dinheiro|contas|(^|[^a-z])valor|parcela|entrada|or[cç]amento|reserva|invest|pagar|pagamento|gast|renda|despesa|margem|caro/],
  ['Não sabe por onde começar', /n[aã]o sabe (por onde|como) (come[cç]ar|iniciar)|n[aã]o tem no[cç][aã]o|n[aã]o tem ideia|passo a passo/],
  ['Insegurança com o resultado', /medo|insegur|receio|resultado|retorno (financeiro|do investimento)|n[aã]o acredita|n[aã]o se acha|capaz|conseguir/],
  ['Tempo / rotina', /tempo|rotina|sobrecarga|trabalhando demais|agenda|disponibilidade/],
  ['Momento / prioridade', /momento|depois|janeiro|fevereiro|mar[cç]o|forma(tura|da|r)|(^|\s)p[oó]s(\s|-|\.|,|$)|pressa|urg[eê]ncia|prioridade|daqui a|resid[eê]ncia|futuramente|mudan[cç]a|obra|remarcar/],
  // o consultor não chegou a descobrir a objeção real: ponto de treino de condução
  ['Não disse o motivo (objeção não descoberta)', /n[aã]o (quis|avancei|avan[cç]ou)|n[aã]o trouxe|registrei|desqualificad|sem motivo|n[aã]o explicou/],
]
const semObjecao = (t: string) => !t || /^\s*(n[aã]o foram registradas obje[cç][oõ]es|nenhuma|-|n\/a)\.?\s*$/i.test(t)
function tipoObjecao(texto: string) {
  const t = texto.normalize('NFC').toLowerCase()
  const fala = /obje[cç]/.test(t) // texto que cita a objeção não cai em "dor"
  // rótulo no começo ("Financeira: ...", "Momento — ..."): vale o tipo que aparece primeiro nele
  const m = t.match(/^([^:\n—–]{1,100})[:—–]/)
  if (m) {
    let melhor = '', pos = 1e9
    for (const [nome, re] of TIPOS_OBJECAO) { if (fala && nome.startsWith('Registrou')) continue; const i = m[1].search(re); if (i >= 0 && i < pos) { pos = i; melhor = nome } }
    if (melhor) return melhor
  }
  for (const [nome, re] of TIPOS_OBJECAO) if (!(fala && nome.startsWith('Registrou')) && re.test(t)) return nome
  return 'Sem tipo identificado'
}
function resumoObjecoes(linhas: any[]) {
  const cont: Record<string, { total: number; contornadas: number; exemplos: any[] }> = {}
  let total = 0, sessoes = 0
  for (const r of linhas) {
    const textos = [r.objecoes, r.objecoes2].filter((t: string) => !semObjecao(t))
    if (!textos.length) continue
    sessoes++
    for (const t of textos) {
      const k = tipoObjecao(t); const c = cont[k] ??= { total: 0, contornadas: 0, exemplos: [] }
      c.total++; total++; if (r.resultado === 'Vendido') c.contornadas++
      // o que foi escrito, para treinar em cima dos casos reais
      c.exemplos.push({ lead: String(r.lead_nome || '').replace(/[,\s]+$/, ''), vendedor: r.vendedor, data: r.data_sessao, resultado: r.resultado, texto: String(t).trim().slice(0, 400) })
    }
  }
  for (const c of Object.values(cont)) c.exemplos.sort((a, b) => (a.data < b.data ? 1 : -1))
  const tipos = Object.entries(cont).map(([tipo, c]) => ({ tipo, ...c, pct: total ? Math.round(c.total / total * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total || a.tipo.localeCompare(b.tipo))
  return { total, sessoes, tipos }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { data: me } = await admin.from('profiles').select('active').eq('id', user.id).single()
  if (!me?.active) return json({ error: 'Usuário inativo' }, 403)

  // Mês pedido pelo funil ("2026-10"); sem mês, ou mês futuro, vale o mês atual.
  let body: any = {}
  try { body = await req.json() } catch { /* sem corpo */ }
  const hojeReal = spHoje()
  let mesPedido = /^\d{4}-\d{2}$/.test(String(body?.mes || '')) ? String(body.mes) : hojeReal.slice(0, 7)
  if (mesPedido > hojeReal.slice(0, 7)) mesPedido = hojeReal.slice(0, 7)
  const atual = mesPedido === hojeReal.slice(0, 7)
  const mesIni = mesPedido + '-01'
  const prox = new Date(mesIni + 'T12:00:00Z'); prox.setUTCMonth(prox.getUTCMonth() + 1)
  const mesFim = prox.toISOString().slice(0, 10)
  // num mês que já terminou, "hoje" é o último dia dele e a "semana" é o mês inteiro (resultado do mês contra a meta do mês)
  const hoje = atual ? hojeReal : addDias(mesFim, -1)
  const semIni = inicioSemana(hoje), semFim = addDias(semIni, 7)

  // A semana conta só os dias dentro do mês (a primeira e a última semana podem ser parciais)
  const wIni = atual ? maxD(semIni, mesIni) : mesIni, wFim = atual ? minD(semFim, mesFim) : mesFim
  const diasSemana = dias(wIni, wFim), diasRestantes = dias(wIni, mesFim)
  const spDia = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10)

  // Leads novos (funil da Mentoria, sem os importados do CRM antigo e sem testes): no mês antes desta semana e nesta semana
  const { data: pipe } = await admin.from('pipelines').select('id').eq('name', 'Mentoria').maybeSingle()
  let qLeads = admin.from('deals').select('id, title, created_at, contact:contacts(source)').gte('created_at', meiaNoiteSP(mesIni)).lt('created_at', meiaNoiteSP(wFim))
  if (pipe?.id) qLeads = qLeads.eq('pipeline_id', pipe.id)
  const { data: leadsRows } = await qLeads
  const leadsOk = (leadsRows ?? []).filter((d: any) => !/teste/i.test(d.title || '') && d.contact?.source !== 'CRM antigo')
  const leads = leadsOk.filter((d: any) => spDia(d.created_at) >= wIni).length
  const leadsAntes = leadsOk.length - leads

  // Sessões agendadas: cards que entraram em "Reunião agendada" (conta a primeira vez no mês)
  const { data: stAg } = await admin.from('stages').select('id').eq('name', 'Reunião agendada')
  const { data: hist } = await admin.from('deal_stage_history').select('deal_id, changed_at').in('to_stage_id', (stAg ?? []).map((s: any) => s.id))
    .gte('changed_at', meiaNoiteSP(mesIni)).lt('changed_at', meiaNoiteSP(wFim))
  const primeiraAg: Record<string, string> = {}
  for (const h of hist ?? []) { const d = spDia((h as any).changed_at); const k = (h as any).deal_id; if (!primeiraAg[k] || d < primeiraAg[k]) primeiraAg[k] = d }
  const agendadas = Object.values(primeiraAg).filter((d) => d >= wIni).length
  const agendadasAntes = Object.values(primeiraAg).length - agendadas

  // Registro de Sessões 1:1 (Plat): realizadas e vendas da semana e do mês, e ranking do mês
  const plat = platClient()
  let semana = { realizadas: 0, vendas: 0 }, mes = { realizadas: 0, vendas: 0, valor: 0, cash: 0, upsells: 0, valor_upsell: 0, cash_upsell: 0 }
  let ranking: any[] = [], ranking_upsell: any[] = []
  let realizadasAntes = 0
  const comparecimento = { semana: { show: 0, noshow: 0 }, mes: { show: 0, noshow: 0 } }
  const objecoes: any = { mes: null, mes_upsell: null, d90: null, d90_upsell: null }
  if (plat) {
    const d90 = addDias(hoje, -90)
    const desde = [mesIni, semIni, d90].sort()[0]
    const { data: vs } = await plat.from('venda_sessoes').select('id, data_sessao, vendedor, presenca, resultado, upsell, valor_numerico, lead_nome, objecoes, objecoes2')
      .gte('data_sessao', desde).lt('data_sessao', mesFim > semFim ? mesFim : semFim)
    // Upsell marcado no card do CRM também conta como upsell, mesmo que o Plat ainda não tenha sido atualizado.
    const idsVenda = (vs ?? []).filter((r: any) => r.resultado === 'Vendido').map((r: any) => r.id)
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
    const novo = (n: string) => ({ nome: n, sessoes: 0, noshow: 0, vendas: 0, valor: 0, cash: 0, upsells: 0, valor_upsell: 0, cash_upsell: 0, sessoes_upsell: 0 })
    // os três consultores sempre aparecem (vendas novas e upsell/renovação), mesmo zerados
    const por: Record<string, any> = { Adriana: novo('Adriana'), Carmem: novo('Carmem'), Diego: novo('Diego') }
    const ehUpsell = (r: any) => !!r.upsell || upsellCRM.has(r.id) || (r.resultado === 'Vendido' && upsellNome.has(sem(r.lead_nome)))
    const doMes = (vs ?? []).filter((r: any) => r.data_sessao >= mesIni && r.data_sessao < mesFim && r.presenca === 'Show')
    const de90 = (vs ?? []).filter((r: any) => r.data_sessao >= d90 && r.data_sessao <= hoje && r.presenca === 'Show')
    objecoes.mes = resumoObjecoes(doMes.filter((r: any) => !ehUpsell(r)))
    objecoes.mes_upsell = resumoObjecoes(doMes.filter(ehUpsell))
    objecoes.d90 = resumoObjecoes(de90.filter((r: any) => !ehUpsell(r)))
    objecoes.d90_upsell = resumoObjecoes(de90.filter(ehUpsell))
    for (const r of vs ?? []) {
      if (r.data_sessao < mesIni && r.data_sessao < wIni) continue
      const up = ehUpsell(r)
      // Comparecimento do time (o SDR confirma as sessões): só sessões de vendas novas
      if (!up && (r.presenca === 'Show' || r.presenca === 'No-show')) {
        const k = r.presenca === 'Show' ? 'show' : 'noshow'
        if (r.data_sessao >= wIni && r.data_sessao < wFim) comparecimento.semana[k]++
        if (r.data_sessao >= mesIni && r.data_sessao < mesFim) comparecimento.mes[k]++
      }
      // Sessão de upsell/renovação (quem já é mentorada) não entra nas sessões das vendas novas:
      // nem na meta de sessões realizadas, nem no denominador da conversão.
      const show = r.presenca === 'Show' && !up, venda = r.resultado === 'Vendido' && !up
      if (r.data_sessao >= wIni && r.data_sessao < wFim) { if (show) semana.realizadas++; if (venda) semana.vendas++ }
      if (r.data_sessao >= mesIni && r.data_sessao < wIni && show) realizadasAntes++
      if (r.data_sessao >= mesIni && r.data_sessao < mesFim) {
        if (show) mes.realizadas++
        if (venda) { mes.vendas++; mes.valor += Number(r.valor_numerico) || 0 }
        const n = quem(r.vendedor); if (!n || /viviane/i.test(n)) continue
        const p = por[n] ??= novo(n)
        if (up) { if (r.presenca === 'Show') p.sessoes_upsell++; continue }
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
      .sort((a: any, b: any) => b.vendas - a.vendas || b.conversao - a.conversao || b.cash - a.cash || b.valor - a.valor)
    ranking_upsell = Object.values(por).map((p: any) => ({ nome: p.nome, sessoes: p.sessoes_upsell, upsells: p.upsells, valor: p.valor_upsell, cash: p.cash_upsell }))
      .sort((a: any, b: any) => b.valor - a.valor || b.cash - a.cash || b.upsells - a.upsells)
  }
  const metas = {
    leads: metaSemana(META_MES.leads, leadsAntes, diasSemana, diasRestantes),
    agendadas: metaSemana(META_MES.agendadas, agendadasAntes, diasSemana, diasRestantes),
    realizadas: metaSemana(META_MES.realizadas, realizadasAntes, diasSemana, diasRestantes),
    vendas_mes: META_MES.vendas,
    mes: META_MES,
    feito_mes: { leads: leadsAntes + leads, agendadas: agendadasAntes + agendadas, realizadas: realizadasAntes + semana.realizadas },
    dias_semana: diasSemana, dias_restantes: diasRestantes,
  }
  const taxa = (c: { show: number; noshow: number }) => ({ ...c, pct: c.show + c.noshow ? Math.round(c.show / (c.show + c.noshow) * 1000) / 10 : null })
  return json({ hoje, atual, mes_ref: mesPedido, semana_ini: wIni, metas, mes_ini: mesIni, leads, agendadas, semana, mes, ranking, ranking_upsell,
    comparecimento: { semana: taxa(comparecimento.semana), mes: taxa(comparecimento.mes) }, objecoes, plat: !!plat })
})
