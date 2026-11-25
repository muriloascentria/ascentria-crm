// Régua de cobrança (pedido do Murilo em 24/11/2026; separada em dois funis em 25/11/2026):
//   funil "Cobrança": lembretes antes do vencimento, só para quem paga no Pix (D-2, D0, Pago);
//   funil "Inadimplentes": quem tem 1 dia ou mais de atraso (Pix ou cartão que falhou), de D+1 até o jurídico.
// Roda pelo cron (Authorization: Bearer <cron_secret>) a cada 5 minutos, das 7h às 21h, e sempre que alguém abre a lista
// "Cobrar hoje": assim, a baixa feita no ePLAT tira o aluno da cobrança em poucos minutos. Lê o financeiro do ePLAT
// (fin_lancamentos a receber, só categorias "EMPRESA | ...") e, para cada cliente:
//   (cartão de crédito: sem D-2/D0; só entra em D+1 se vencer sem baixa)
//   - parcela vencendo em 1–2 dias      → card em "Vence em 2 dias (D-2)"
//   - parcela vencendo hoje             → card em "Vence hoje (D0)"
//   - parcela vencida e ainda não paga  → a partir das 14h, card que estava em D-2/D0 segue para "1º lembrete (D+1)"
//   - todas as parcelas acompanhadas pagas → card vai para "Regularizado"
// Não envia nenhuma mensagem: só cria/move os cards. As colunas seguintes continuam com a lista "Cobrar hoje".
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } })
const PIPE_INAD = '1731d20c-e32a-4a67-a537-b8bc653c1e1f' // Inadimplentes: 1 dia ou mais de atraso
const PIPE_COB = '2354ef40-0887-44f4-b584-e9c1c2bd2315'  // Cobrança: lembretes antes do vencimento (só Pix)
const PIPES = [PIPE_INAD, PIPE_COB]
const DONO = '08636121-ce1c-4884-9e6a-8f6ce30958ba' // Murilo
const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')
const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const br = (iso: string) => iso.split('-').reverse().join('/')
const telefone = (s: string | null | undefined) => {
  const d = digits(s)
  if (!d) return null
  if (String(s).trim().startsWith('+')) return '+' + d
  return d.length >= 12 && d.startsWith('55') ? '+' + d : '+55' + d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  // chamada pelo cron (cron_secret) ou pelo próprio CRM, por um usuário logado, ao abrir a lista "Cobrar hoje"
  let { data: ok } = await admin.rpc('check_cron_secret', { p: t })
  if (!ok && t) {
    const { data: u } = await admin.auth.getUser(t)
    if (u?.user) { const { data: pr } = await admin.from('profiles').select('active').eq('id', u.user.id).maybeSingle(); ok = !!pr?.active }
  }
  if (!ok) return json({ error: 'não autorizado' }, 401)
  const platKey = Deno.env.get('PLAT_SERVICE_KEY')
  if (!platKey) return json({ ok: false, error: 'PLAT_SERVICE_KEY ausente' })
  const plat = createClient(Deno.env.get('PLAT_URL') ?? 'https://yahjhvnubmmfvxbjxmoo.supabase.co', platKey, { auth: { persistSession: false } })

  // data e hora de Brasília
  const agora = new Date(Date.now() - 3 * 3600_000)
  const hoje = agora.toISOString().slice(0, 10)
  const hora = agora.getUTCHours()
  const somaDias = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
  const ate = somaDias(hoje, 2)

  const { data: stages } = await admin.from('stages').select('id, name, pipeline_id').in('pipeline_id', PIPES)
  const st = (re: RegExp) => stages?.find((s) => re.test(s.name))?.id
  const S = { d2: st(/D-2/), d0: st(/D0/), d1: st(/D\+1\b/), reg: st(/^Regularizado/), pago: stages?.find((s) => s.pipeline_id === PIPE_COB && /^Pago/.test(s.name))?.id }
  if (!S.d2 || !S.d0 || !S.d1 || !S.reg || !S.pago) return json({ ok: false, error: 'colunas do funil não encontradas' })

  const { data: cats } = await plat.from('fin_categorias').select('id, nome').ilike('nome', 'EMPRESA |%')
  const catIds = (cats ?? []).map((c) => c.id)
  const catNome = new Map((cats ?? []).map((c) => [c.id, String(c.nome).replace(/^EMPRESA \|\s*/, '')]))

  // parcelas em aberto que vencem até daqui a 2 dias (inclui as já vencidas)
  const { data: abertas0, error: e1 } = await plat.from('fin_lancamentos')
    .select('id, cliente_id, valor, data_vencimento, categoria_id, forma_id, parcela_num, parcela_total')
    .eq('tipo', 'receber').eq('pagou', false).lte('data_vencimento', ate).in('categoria_id', catIds).not('cliente_id', 'is', null)
  if (e1) return json({ ok: false, error: e1.message })
  // Cartão de crédito (recorrente) é cobrado sozinho: não recebe os avisos de D-2 e D0.
  // A parcela no cartão só conta depois de vencida sem baixa (cobrança falhou ou falta dar baixa) → entra em D+1.
  const { data: formas } = await plat.from('fin_formas').select('id, nome')
  const cartao = new Set((formas ?? []).filter((f) => /cart/i.test(String(f.nome))).map((f) => f.id))
  const abertas = (abertas0 ?? []).filter((l) => !cartao.has(l.forma_id) || l.data_vencimento < hoje)

  // cards abertos do funil acompanhados por este robô (ou importados com plat_cliente_id)
  const { data: cards } = await admin.from('deals').select('id, title, stage_id, pipeline_id, contact_id, custom, value').in('pipeline_id', PIPES).eq('status', 'open')
  const porCliente = new Map<number, any>()
  for (const c of cards ?? []) if (c.custom?.plat_cliente_id) porCliente.set(Number(c.custom.plat_cliente_id), c)

  const grupos = new Map<number, any[]>()
  for (const l of abertas ?? []) { const k = Number(l.cliente_id); grupos.set(k, [...(grupos.get(k) ?? []), l]) }
  const log: any[] = []
  const nota = (deal_id: string, contact_id: string | null, title: string, description: string) =>
    admin.from('activities').insert({ type: 'note', title, description, deal_id, contact_id, assigned_to: DONO, created_by: DONO, due_at: new Date().toISOString() })

  // 1) clientes com parcela em aberto: cria ou move o card
  if (grupos.size) {
    const { data: clientes } = await plat.from('registro_clientes').select('id, nome, whatsapp, email').in('id', [...grupos.keys()])
    const cli = new Map((clientes ?? []).map((c) => [Number(c.id), c]))
    for (const [cid, ls] of grupos) {
      const c = cli.get(cid); if (!c) continue
      ls.sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
      const primeira = ls[0].data_vencimento
      const total = ls.reduce((s, l) => s + Number(l.valor || 0), 0)
      const produtos = [...new Set(ls.map((l) => catNome.get(l.categoria_id) || 'Ascentria'))].join(', ')
      const alvo = primeira > hoje ? S.d2 : primeira === hoje ? S.d0 : (hora >= 14 ? S.d1 : null)
      const custom = { plat_cliente_id: cid, lanc_ids: ls.map((l) => l.id), produto: produtos, total_aberto: total, primeiro_vencimento: primeira }
      const card = porCliente.get(cid)
      const resumo = `${produtos}: ${ls.length} parcela(s), total R$ ${brl(total)}, primeiro vencimento em ${br(primeira)}.`
      if (card) {
        const upd: any = { value: total, custom: { ...(card.custom || {}), ...custom } }
        // só move automaticamente dentro da régua (D-2 → D0 → D+1); daí em diante é pela lista "Cobrar hoje"
        const naRegua = card.stage_id === S.d2 || card.stage_id === S.d0
        if (alvo && naRegua && alvo !== card.stage_id && !(card.stage_id === S.d0 && alvo === S.d2)) {
          upd.stage_id = alvo
          await nota(card.id, card.contact_id, alvo === S.d1 ? 'Não pagou no vencimento: segue para a cobrança' : 'Parcela vence hoje', resumo)
          log.push({ cliente: c.nome, moveu: alvo })
        }
        // rodando a cada 5 min: só grava quando algo mudou
        const mudou = upd.stage_id || Number(card.value) !== total || JSON.stringify(card.custom?.lanc_ids ?? []) !== JSON.stringify(custom.lanc_ids)
        if (mudou) await admin.from('deals').update(upd).eq('id', card.id)
        continue
      }
      if (!alvo) continue // vencida, mas ainda antes das 14h: espera a rodada da tarde
      if (alvo === S.d1 && primeira < somaDias(hoje, -1)) continue // atrasos antigos não entram sozinhos (já foram importados à mão)
      // outra rodada (cron e lista abertos ao mesmo tempo) pode ter criado o card agora: não duplica
      const { data: jaTem } = await admin.from('deals').select('id').in('pipeline_id', PIPES).eq('status', 'open').eq('custom->>plat_cliente_id', String(cid)).limit(1)
      if (jaTem?.length) continue
      // contato: pelo telefone (8 últimos dígitos) ou e-mail; cria se não existir
      const fone = telefone(c.whatsapp)
      let contactId: string | null = null
      if (fone) {
        const { data: m } = await admin.rpc('contato_por_fone', { p: fone })
        contactId = m || null
      }
      if (!contactId && c.email) {
        const { data: m } = await admin.from('contacts').select('id').ilike('email', c.email).limit(1).maybeSingle()
        contactId = m?.id || null
      }
      if (!contactId) {
        const { data: novo } = await admin.from('contacts').insert({ name: c.nome, phone: fone, wa_id: fone ? fone.slice(1) : null, email: c.email, source: 'ePLAT – financeiro', tags: ['cobrança'], owner_id: DONO, created_by: DONO }).select('id').single()
        contactId = novo?.id || null
      }
      const { data: d } = await admin.from('deals').insert({ title: c.nome, pipeline_id: alvo === S.d1 ? PIPE_INAD : PIPE_COB, stage_id: alvo, contact_id: contactId, owner_id: DONO, created_by: DONO, value: total, custom }).select('id').single()
      if (d) await nota(d.id, contactId, alvo === S.d2 ? 'Parcela vence em breve' : alvo === S.d0 ? 'Parcela vence hoje' : 'Não pagou no vencimento: segue para a cobrança', resumo)
      log.push({ cliente: c.nome, criou: alvo })
    }
  }

  // 2) cards acompanhados cujas parcelas foram todas pagas → Regularizado
  for (const card of cards ?? []) {
    const ids: string[] = card.custom?.lanc_ids ?? []
    const cid = Number(card.custom?.plat_cliente_id)
    if (!ids.length || grupos.has(cid)) continue
    const { data: ls } = await plat.from('fin_lancamentos').select('id, pagou').in('id', ids)
    if (ls?.length && ls.every((l) => l.pagou)) {
      await admin.from('deals').update({ stage_id: card.pipeline_id === PIPE_COB ? S.pago : S.reg }).eq('id', card.id)
      await nota(card.id, card.contact_id, card.pipeline_id === PIPE_COB ? 'Pagamento confirmado no ePLAT: pago' : 'Pagamento confirmado no ePLAT: regularizado', `Todas as ${ls.length} parcela(s) acompanhada(s) constam como pagas no financeiro do ePLAT.`)
      log.push({ cliente: card.title, regularizado: true })
    }
  }
  return json({ ok: true, hoje, hora, mudancas: log })
})
