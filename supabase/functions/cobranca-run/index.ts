// Carteira de alunos e régua de cobrança (pedido do Murilo em 24–25/11/2026). Dois funis:
//   "Cobrança": um card por mentorado ativo, na coluna da sua situação:
//      Vence em 5 dias (D-5) / Vence hoje (D0)   → só quem paga no Pix, com parcela vencendo
//      Em dia · Pix / Em dia · Cartão recorrente / Em dia · Cartão normal ou à vista
//      Agendar acompanhamento · Quitação 20%     → 4+ meses na mentoria, em dia, Pix ou cartão recorrente, com saldo a pagar
//      Agendar acompanhamento · Renovação        → 6+ meses na mentoria e mentoria já quitada (nada a pagar, ou cartão normal / à vista)
//      Acompanhamento agendado / Oferta feita    → colunas manuais (a rotina não mexe)
//   "Inadimplentes": quem tem 1 dia ou mais de atraso (Pix depois das 14h do dia seguinte; cartão que falhou), de D+1
//      até o jurídico; quando tudo aparece pago no ePLAT, vai para Regularizado e volta para a carteira (Cobrança).
// Roda pelo cron (Bearer <cron_secret>) a cada 5 min, das 7h às 21h, e quando alguém abre a lista do topo do funil.
// Não envia mensagem nenhuma: só cria/move os cards e avisa a Carmem (tarefa) quando alguém fica elegível.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } })
const PIPE_INAD = '1731d20c-e32a-4a67-a537-b8bc653c1e1f'
const PIPE_COB = '2354ef40-0887-44f4-b584-e9c1c2bd2315'
const PIPES = [PIPE_INAD, PIPE_COB]
const DONO = '08636121-ce1c-4884-9e6a-8f6ce30958ba' // Murilo
const CARMEM = '6427266a-e125-40cf-bfcc-313c09a737ee' // perfil da Carmem no CRM (quem faz o acompanhamento)
const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const br = (iso: string) => String(iso).slice(0, 10).split('-').reverse().join('/')
const telefone = (s: string | null | undefined) => {
  const d = digits(s)
  if (!d) return null
  if (String(s).trim().startsWith('+')) return '+' + d
  return d.length >= 12 && d.startsWith('55') ? '+' + d : '+55' + d
}

async function todas(q: () => any) {
  const out: any[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await q().range(de, de + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  let { data: ok } = await admin.rpc('check_cron_secret', { p: t })
  if (!ok && t) {
    const { data: u } = await admin.auth.getUser(t)
    if (u?.user) { const { data: pr } = await admin.from('profiles').select('active').eq('id', u.user.id).maybeSingle(); ok = !!pr?.active }
  }
  if (!ok) return json({ error: 'não autorizado' }, 401)
  const platKey = Deno.env.get('PLAT_SERVICE_KEY')
  if (!platKey) return json({ ok: false, error: 'PLAT_SERVICE_KEY ausente' })
  const plat = createClient(Deno.env.get('PLAT_URL') ?? 'https://yahjhvnubmmfvxbjxmoo.supabase.co', platKey, { auth: { persistSession: false } })
  try { return json(await rodar(admin, plat)) } catch (e) { console.error('cobranca-run', (e as Error).message); return json({ ok: false, error: (e as Error).message }) }
})

async function rodar(admin: any, plat: any) {
  const agora = new Date(Date.now() - 3 * 3600_000) // Brasília
  const hoje = agora.toISOString().slice(0, 10)
  const hora = agora.getUTCHours()
  const somaDias = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
  const ontem = somaDias(hoje, -1), ate = somaDias(hoje, 5) // lembrete 5 dias antes (pedido de 25/11)
  const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T12:00:00Z')) / 86_400_000)

  // colunas
  const { data: stages } = await admin.from('stages').select('id, name, pipeline_id').in('pipeline_id', PIPES)
  const col = (pipe: string, re: RegExp) => stages?.find((s: any) => s.pipeline_id === pipe && re.test(s.name))?.id
  const S: Record<string, string> = {
    d2: col(PIPE_COB, /^Vence em \d+ dias|D-[25]\b/), d0: col(PIPE_COB, /D0/), pix: col(PIPE_COB, /^Em dia · Pix/), rec: col(PIPE_COB, /^Em dia · Cartão recorrente/),
    cn: col(PIPE_COB, /^Em dia · Cartão normal/), aq: col(PIPE_COB, /Quitação/), ar: col(PIPE_COB, /Agendar.*Renovação/),
    ag: col(PIPE_COB, /^Acompanhamento agendado/), of: col(PIPE_COB, /^Oferta feita/),
    atr: col(PIPE_INAD, /^Parcela em atraso/), d1: col(PIPE_INAD, /D\+1\b/), reg: col(PIPE_INAD, /^Regularizado/),
  }
  const faltando = Object.entries(S).filter(([, v]) => !v).map(([k]) => k)
  if (faltando.length) return { ok: false, error: 'colunas não encontradas: ' + faltando.join(', ') }
  const AUTO = new Set([S.d2, S.d0, S.pix, S.rec, S.cn, S.aq, S.ar])
  const nomeCol = new Map((stages ?? []).map((s: any) => [s.id, s.name]))

  // financeiro do ePLAT (só categorias da empresa)
  const { data: cats } = await plat.from('fin_categorias').select('id, nome').ilike('nome', 'EMPRESA |%')
  const catIds = (cats ?? []).map((c: any) => c.id)
  const catMentoria = new Set((cats ?? []).filter((c: any) => /Mentoria/i.test(c.nome)).map((c: any) => c.id))
  const { data: formas } = await plat.from('fin_formas').select('id, nome')
  const cartao = new Set((formas ?? []).filter((f: any) => /cart/i.test(String(f.nome))).map((f: any) => f.id))
  const lancs = await todas(() => plat.from('fin_lancamentos').select('id, cliente_id, valor, data_vencimento, categoria_id, forma_id, repete_modo, pagou')
    .eq('tipo', 'receber').in('categoria_id', catIds).not('cliente_id', 'is', null).order('id'))
  const porCliente = new Map<number, any[]>()
  for (const l of lancs) { const k = Number(l.cliente_id); porCliente.set(k, [...(porCliente.get(k) ?? []), l]) }

  // alunos: mentorados ativos (não teste, sem acesso cancelado) com data de matrícula
  const ids = [...porCliente.keys()]
  const clientes: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await plat.from('registro_clientes').select('id, nome, whatsapp, email, student_id').in('id', ids.slice(i, i + 200))
    clientes.push(...(data ?? []))
  }
  const sids = clientes.map((c: any) => c.student_id).filter(Boolean)
  const vazio = ['00000000-0000-0000-0000-000000000000']
  const { data: perfis } = await plat.from('profiles').select('id, role, tier, conta_teste').in('id', sids.length ? sids : vazio)
  const { data: cads } = await plat.from('student_cadastro').select('student_id, data_matricula').in('student_id', sids.length ? sids : vazio)
  const { data: cancel } = await plat.from('acesso_cancelado').select('aluno_id, ativo')
  const cancelado = new Set((cancel ?? []).filter((c: any) => c.ativo !== false).map((c: any) => c.aluno_id))
  const perfil = new Map((perfis ?? []).map((p: any) => [p.id, p]))
  const matricula = new Map((cads ?? []).map((c: any) => [c.student_id, c.data_matricula]))

  // cards abertos dos dois funis (um por cliente do financeiro)
  const cards = await todas(() => admin.from('deals').select('id, title, stage_id, pipeline_id, contact_id, custom, value').in('pipeline_id', PIPES).eq('status', 'open').order('id'))
  const cardDe = new Map<number, any>()
  for (const c of cards) if (c.custom?.plat_cliente_id) cardDe.set(Number(c.custom.plat_cliente_id), c)

  const log: any[] = []
  const nota = (deal_id: string, contact_id: string | null, title: string, description: string) =>
    admin.from('activities').insert({ type: 'note', title, description, deal_id, contact_id, assigned_to: DONO, created_by: DONO, due_at: new Date().toISOString() })

  async function contatoPara(c: any) {
    const fone = telefone(c.whatsapp)
    if (fone) { const { data: m } = await admin.rpc('contato_por_fone', { p: fone }); if (m) return m }
    if (c.email) { const { data: m } = await admin.from('contacts').select('id').ilike('email', c.email).limit(1).maybeSingle(); if (m?.id) return m.id }
    const { data: novo } = await admin.from('contacts').insert({ name: c.nome, phone: fone, wa_id: fone ? fone.slice(1) : null, email: c.email, source: 'ePLAT – financeiro', tags: ['cobrança'], owner_id: DONO, created_by: DONO }).select('id').single()
    return novo?.id ?? null
  }

  for (const c of clientes) {
    const cid = Number(c.id)
    const ls = porCliente.get(cid) ?? []
    const p: any = c.student_id ? perfil.get(c.student_id) : null
    const mentorado = !!p && p.role === 'aluno' && p.tier === 'mentorado' && !p.conta_teste && !cancelado.has(c.student_id)
    const abertas = ls.filter((l) => !l.pagou).sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
    const vencidas = abertas.filter((l) => l.data_vencimento < hoje)
    const proxPix = abertas.filter((l) => !cartao.has(l.forma_id) && l.data_vencimento >= hoje && l.data_vencimento <= ate)
    const ment = ls.filter((l) => catMentoria.has(l.categoria_id))
    const futuras = ment.filter((l) => !l.pagou && l.data_vencimento >= hoje)
    const rec = ment.some((l) => cartao.has(l.forma_id) && l.repete_modo === 'repetir' && !l.pagou)
    const pixp = ment.some((l) => !cartao.has(l.forma_id) && l.repete_modo === 'repetir' && !l.pagou)
    const tipo = rec ? 'cartao_recorrente' : pixp ? 'pix' : 'cartao_normal'
    const saldo = futuras.reduce((s, l) => s + Number(l.valor || 0), 0)
    const mat = c.student_id ? matricula.get(c.student_id) : null
    const meses = mat ? Math.floor(diasEntre(mat, hoje) / 30.44) : null
    const card = cardDe.get(cid)
    const atrasado = vencidas.length > 0 && (vencidas[0].data_vencimento < ontem || hora >= 14)
    const totalAtraso = vencidas.reduce((s, l) => s + Number(l.valor || 0), 0)

    let alvo: string | null = null, titulo = '', valor = 0
    let elegivel: string | null = card?.custom?.elegivel ?? null
    const ofertas = { ...(card?.custom?.ofertas || {}) }
    // quem está na coluna "Oferta feita": registra qual oferta foi feita (a da coluna de onde veio)
    if (card && card.stage_id === S.of && elegivel && !ofertas[elegivel]) ofertas[elegivel] = hoje

    if (atrasado) {
      valor = totalAtraso
      if (!card || card.pipeline_id === PIPE_COB) alvo = vencidas[0].data_vencimento >= ontem ? S.d1 : S.atr
      titulo = 'Não pagou no vencimento: segue para Inadimplentes'
    } else if (vencidas.length) {
      continue // venceu ontem, mas ainda antes das 14h: espera a rodada da tarde
    } else if (card && card.pipeline_id === PIPE_INAD) {
      alvo = S.reg; valor = Number(card.value) || 0; titulo = 'Pagamento confirmado no ePLAT: regularizado' // volta para a carteira na próxima rodada
    } else {
      if (!mentorado && !proxPix.length && !card) continue // fora da carteira e sem nada vencendo: não precisa de card
      valor = proxPix.length ? proxPix.reduce((s, l) => s + Number(l.valor || 0), 0) : saldo
      const emDia = tipo === 'pix' ? S.pix : tipo === 'cartao_recorrente' ? S.rec : S.cn
      let desejado = emDia
      let novoEleg: string | null = null
      if (mentorado && meses != null) {
        // renovação (pedido de 25/11): 6+ meses e mentoria já quitada (a empresa recebeu o valor total): nada a pagar, ou cartão normal / à vista
        const quitado = saldo <= 0 || tipo === 'cartao_normal'
        if (meses >= 6 && quitado && !ofertas.renovacao) { desejado = S.ar; novoEleg = 'renovacao' }
        else if (meses >= 4 && tipo !== 'cartao_normal' && saldo > 0 && !ofertas.quitacao) { desejado = S.aq; novoEleg = 'quitacao' }
      }
      if (proxPix.length) desejado = proxPix[0].data_vencimento === hoje ? S.d0 : S.d2
      if (!card || AUTO.has(card.stage_id)) { alvo = desejado; elegivel = novoEleg ?? (desejado === S.d2 || desejado === S.d0 ? elegivel : null) }
      titulo = alvo === S.d2 ? 'Parcela vence em breve' : alvo === S.d0 ? 'Parcela vence hoje' : alvo === S.aq ? 'Elegível para quitação antecipada (20%)' : alvo === S.ar ? 'Elegível para renovação' : 'Pagamentos em dia'
    }

    const ref = atrasado ? vencidas[0] : proxPix[0] || futuras[0]
    const custom = {
      ...(card?.custom || {}), plat_cliente_id: cid, plat_student_id: c.student_id ?? null, forma: tipo, mentorado, meses_mentoria: meses,
      matricula: mat ?? null, saldo_a_pagar: Math.round(saldo * 100) / 100, quitacao_20: Math.round(saldo * 0.8 * 100) / 100,
      lanc_ids: (atrasado ? vencidas : proxPix).map((l) => l.id), primeiro_vencimento: ref?.data_vencimento ?? null,
      total_aberto: atrasado ? totalAtraso : valor, elegivel, ofertas,
    }
    const resumo = [
      atrasado ? `Em atraso: ${vencidas.length} parcela(s), R$ ${brl(totalAtraso)}, desde ${br(vencidas[0].data_vencimento)}.` : null,
      proxPix.length ? `Parcela de R$ ${brl(proxPix[0].valor)} vence em ${br(proxPix[0].data_vencimento)}.` : null,
      meses != null ? `${meses} mês(es) na mentoria (matrícula em ${br(mat)}).` : null,
      `Forma: ${tipo === 'pix' ? 'Pix' : tipo === 'cartao_recorrente' ? 'cartão recorrente' : 'cartão normal / à vista'}. Saldo a pagar: R$ ${brl(saldo)}.`,
      elegivel === 'quitacao' ? `Quitação antecipada com 20% de desconto: R$ ${brl(saldo * 0.8)} (em vez de R$ ${brl(saldo)}).` : null,
    ].filter(Boolean).join('\n')

    if (!card) {
      if (!alvo) continue
      const { data: jaTem } = await admin.from('deals').select('id').in('pipeline_id', PIPES).eq('status', 'open').eq('custom->>plat_cliente_id', String(cid)).limit(1)
      if (jaTem?.length) continue // outra rodada criou agora
      const contactId = await contatoPara(c)
      const pipe = alvo === S.d1 || alvo === S.atr ? PIPE_INAD : PIPE_COB
      const { data: d } = await admin.from('deals').insert({ title: c.nome, pipeline_id: pipe, stage_id: alvo, contact_id: contactId, owner_id: DONO, created_by: DONO, value: valor, custom }).select('id').single()
      // duas rodadas ao mesmo tempo (cron e lista aberta) podem criar o mesmo card: fica só o mais antigo
      const { data: iguais } = await admin.from('deals').select('id').in('pipeline_id', PIPES).eq('status', 'open').eq('custom->>plat_cliente_id', String(cid)).order('created_at').order('id')
      if (d && iguais && iguais.length > 1 && iguais[0].id !== d.id) { await admin.from('deals').delete().eq('id', d.id); continue }
      if (d) {
        await nota(d.id, contactId, titulo, resumo)
        if (alvo === S.aq || alvo === S.ar) await tarefaCarmem(admin, d.id, contactId, c.nome, alvo === S.aq, resumo)
      }
      log.push({ cliente: c.nome, criou: nomeCol.get(alvo) })
      continue
    }
    const move = !!alvo && alvo !== card.stage_id
    const mudou = move || Number(card.value) !== valor || JSON.stringify(card.custom || {}) !== JSON.stringify(custom)
    if (!mudou) continue
    await admin.from('deals').update(move ? { stage_id: alvo, value: valor, custom } : { value: valor, custom }).eq('id', card.id)
    if (move) {
      await nota(card.id, card.contact_id, titulo, resumo)
      if (alvo === S.aq || alvo === S.ar) await tarefaCarmem(admin, card.id, card.contact_id, c.nome, alvo === S.aq, resumo)
      // saiu de "Agendar acompanhamento" sem a reunião ter sido marcada (deixou de ser elegível): tira a tarefa da Carmem
      else if ((card.stage_id === S.aq || card.stage_id === S.ar) && alvo !== S.d2 && alvo !== S.d0)
        await admin.from('activities').delete().eq('deal_id', card.id).eq('done', false).eq('type', 'task').ilike('title', 'Agendar reunião de acompanhamento%')
      log.push({ cliente: c.nome, moveu: nomeCol.get(alvo) })
    }
  }
  // eCRM ↔ ePLAT (pedido de 25/11): conversas e negociações registradas nos cards viram registro no "Registro de
  // Cobranças Financeiras" do aluno no ePLAT, e o que a Mari registrar no ePLAT aparece como nota no card
  let sync: any = null
  try { sync = await sincronizarRegistros(admin, plat, log) } catch (e) { console.error('sync', (e as Error).message); sync = { erro: (e as Error).message } }
  return { ok: true, hoje, hora, mudancas: log.length, detalhe: log.slice(0, 60), sync }
}

// o que a própria rotina escreve (notas automáticas e a tarefa da Carmem) não é conversa: não vai para o ePLAT
const ROBO = /^(Parcela vence|Não pagou no vencimento|Pagamento confirmado no ePLAT|Em atraso no financeiro da Plat|Registro no ePLAT|Pagamentos em dia|Elegível para|Agendar reunião de acompanhamento)/
const RESP: Record<string, string> = { Carmem: 'Carmem Goretty', Diego: 'Diego Eller', Murilo: 'Murilo Pedroso', Mariane: 'Mariane', Mari: 'Mariane', Sandra: 'Sandra Bublitz', Viviane: 'Viviane da Silva' }
const CANAL: Record<string, string> = { whatsapp: 'whatsapp', call: 'ligacao', email: 'email', meeting: 'reuniao' }

async function sincronizarRegistros(admin: any, plat: any, log: any[]) {
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString() // dedupe pela tabela plat_cobranca_sync
  const { data: cards } = await admin.from('deals').select('id, title, status, contact_id, stage_id, value, custom, stage:stages(name)').in('pipeline_id', PIPES)
  const comCliente = (cards ?? []).filter((c: any) => c.custom?.plat_cliente_id).sort((a: any, b: any) => (a.status === 'open' ? 1 : 0) - (b.status === 'open' ? 1 : 0))
  if (!comCliente.length) return { enviados: 0, recebidos: 0 }
  const { data: clientes } = await plat.from('registro_clientes').select('id, student_id').in('id', comCliente.map((c: any) => Number(c.custom.plat_cliente_id)))
  const aluno = new Map((clientes ?? []).map((c: any) => [Number(c.id), c.student_id]))
  const cardPorAluno = new Map<string, any>()
  for (const c of comCliente) { const sid = aluno.get(Number(c.custom.plat_cliente_id)); if (sid) cardPorAluno.set(sid, c) }
  const cardPorId = new Map(comCliente.map((c: any) => [c.id, c]))
  let enviados = 0, recebidos = 0, semAluno = 0

  // eCRM → ePLAT
  const { data: ativs } = await admin.from('activities').select('id, type, title, description, due_at, deal_id, created_by, created_at, autor:profiles!activities_created_by_fkey(full_name)')
    .in('deal_id', comCliente.map((c: any) => c.id)).gte('created_at', desde).order('created_at')
  const { data: jaFoi } = await admin.from('plat_cobranca_sync').select('activity_id').in('activity_id', (ativs ?? []).map((a: any) => a.id).concat(['00000000-0000-0000-0000-000000000000']))
  const feitos = new Set((jaFoi ?? []).map((x: any) => x.activity_id))
  for (const a of ativs ?? []) {
    if (feitos.has(a.id) || ROBO.test(a.title || '')) continue
    const card: any = cardPorId.get(a.deal_id)
    const sid = card && aluno.get(Number(card.custom.plat_cliente_id))
    if (!sid) { semAluno++; continue }
    const nome = String(a.autor?.full_name || 'Mariane').split(' ')[0]
    const etapa = String(card.stage?.name || '')
    const resultado = /negocia|Acordo/i.test(etapa) ? 'negociado' : /Regularizado|^Pago/.test(etapa) ? 'pago' : /jur[ií]dico/i.test(etapa) ? 'juridico' : null
    const venc = card.custom?.primeiro_vencimento ? 'Vencimento desde ' + String(card.custom.primeiro_vencimento).split('-').reverse().join('/') : null
    const prox = a.type !== 'note' && a.due_at && Date.parse(a.due_at) > Date.now() ? new Date(Date.parse(a.due_at) - 3 * 3600_000).toISOString().slice(0, 10) : null
    const reg = {
      student_id: sid, data: new Date(Date.parse(a.created_at) - 3 * 3600_000).toISOString().slice(0, 10),
      canal: CANAL[a.type] || 'whatsapp', responsavel: RESP[nome] || a.autor?.full_name || 'Mariane',
      valor: card.value != null ? Number(card.value) : null, parcelas: venc, resultado, proximo_passo: prox,
      resumo: `[eCRM · ${etapa}] ${a.title}${a.description ? '\n' + a.description : ''}`.slice(0, 4000),
    }
    // reserva antes de gravar: se outra rodada já pegou este registro, pula (evita duplicar no ePLAT)
    const { data: vaga, error: ocupado } = await admin.from('plat_cobranca_sync').insert({ activity_id: a.id, direcao: 'crm_para_plat' }).select('id').single()
    if (ocupado || !vaga) continue
    const { data: novo, error } = await plat.from('cobranca_registros').insert(reg).select('id').single()
    if (error) { console.error('sync → ePLAT', a.id, error.message); await admin.from('plat_cobranca_sync').delete().eq('id', vaga.id); continue }
    await admin.from('plat_cobranca_sync').update({ plat_registro_id: novo.id }).eq('id', vaga.id)
    enviados++
  }

  // ePLAT → eCRM
  const { data: regs } = await plat.from('cobranca_registros').select('id, student_id, data, canal, responsavel, valor, parcelas, resultado, proximo_passo, resumo, created_at')
    .in('student_id', [...cardPorAluno.keys()]).gte('created_at', desde)
  const { data: jaVeio } = await admin.from('plat_cobranca_sync').select('plat_registro_id').in('plat_registro_id', (regs ?? []).map((r: any) => r.id).concat([-1]))
  const vieram = new Set((jaVeio ?? []).map((x: any) => Number(x.plat_registro_id)))
  const RES: Record<string, string> = { sem_resposta: 'Sem resposta', prometeu: 'Prometeu pagar', negociado: 'Negociado', pago: 'Pago', recusou: 'Recusou pagar', juridico: 'Encaminhado ao jurídico' }
  for (const r of regs ?? []) {
    if (vieram.has(Number(r.id)) || String(r.resumo || '').startsWith('[eCRM')) continue
    const card = cardPorAluno.get(r.student_id); if (!card) continue
    const linhas = [r.resumo, r.resultado ? `Resultado: ${RES[r.resultado] || r.resultado}` : '', r.proximo_passo ? `Próximo passo: ${String(r.proximo_passo).split('-').reverse().join('/')}` : '', r.valor != null ? `Valor: R$ ${brl(Number(r.valor))}` : '', r.parcelas ? `Parcelas: ${r.parcelas}` : ''].filter(Boolean)
    const { data: vaga, error: ocupado } = await admin.from('plat_cobranca_sync').insert({ plat_registro_id: r.id, direcao: 'plat_para_crm' }).select('id').single()
    if (ocupado || !vaga) continue
    const { data: nova } = await admin.from('activities').insert({ type: 'note', title: `Registro no ePLAT (${r.responsavel})`, description: linhas.join('\n'), deal_id: card.id, contact_id: card.contact_id, assigned_to: DONO, created_by: DONO, due_at: new Date().toISOString() }).select('id').single()
    if (nova) { await admin.from('plat_cobranca_sync').update({ activity_id: nova.id }).eq('id', vaga.id); recebidos++ }
    else await admin.from('plat_cobranca_sync').delete().eq('id', vaga.id)
  }
  if (enviados || recebidos) log.push({ sync: { enviados, recebidos } })
  return { enviados, recebidos, semAluno }
}

// Sinaliza para a Carmem que é hora de marcar a reunião de acompanhamento (onde ela apresenta a oferta).
async function tarefaCarmem(admin: any, dealId: string, contactId: string | null, nome: string, quitacao: boolean, resumo: string) {
  const title = `Agendar reunião de acompanhamento: ${nome} (${quitacao ? 'oferecer quitação antecipada com 20%' : 'oferecer renovação'})`
  const description = `${resumo}\n\nA Mari envia o convite para uma reunião de acompanhamento normal da mentoria (pela lista do topo do funil Cobrança). Na reunião, a Carmem apresenta a ${quitacao ? 'quitação antecipada com 20% de desconto' : 'renovação'}. Depois da reunião, mova o card para "Oferta feita".`
  const { data: ja } = await admin.from('activities').select('id, title').eq('deal_id', dealId).eq('done', false).ilike('title', 'Agendar reunião de acompanhamento%').limit(1)
  // se a oferta mudou (ex.: saiu de renovação para quitação), corrige a tarefa aberta em vez de criar outra
  if (ja?.length) { if (ja[0].title !== title) await admin.from('activities').update({ title, description }).eq('id', ja[0].id); return }
  await admin.from('activities').insert({
    type: 'task', title,
    description,
    deal_id: dealId, contact_id: contactId, assigned_to: CARMEM, created_by: DONO, due_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  })
}
