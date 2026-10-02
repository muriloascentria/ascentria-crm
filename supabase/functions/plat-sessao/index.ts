// Registro da sessão 1:1 de venda, feito pela consultora no card do lead.
// Ao salvar: guarda no card (deals.sessao_registro) e grava/atualiza a linha correspondente no
// Essência Plat (tabela venda_sessoes = tela "Registro de Sessões 1:1"). O próprio Plat cria sozinho a
// linha da "Análise Sessões 1:1" quando uma sessão nova entra.
// Depois, conforme o resultado, o card muda de coluna (Vendido → ganho; Não vendido → Perdido
// apresentado; No-show → Remarcar).
//
// Body: { deal_id, dados: { data, lead, whatsapp, vendedor, produto, upsell, formato, presenca,
//         resultado, valor, objecao1, objecao2, observacoes, contrato, video, transcricao } }
// Gravação e transcrição vazias são completadas com os anexos da reunião já encontrados no card.
// Secrets: PLAT_SERVICE_KEY (chave de serviço do projeto do Essência Plat)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/wa.ts'
import { linksReuniao, platClient } from '../_shared/plat.ts'

const SEM_OBJECAO = 'Não foram registradas objeções.'
const SEM_OBSERVACAO = 'Não foram registradas observações.'

const txt = (v: unknown, max = 5000) => String(v ?? '').trim().slice(0, max)
const ouPadrao = (v: unknown, padrao: string) => txt(v) || padrao
// "R$ 5.997,00" → 5997 ; "5997.5" → 5997.5
function valorNumero(t: string): number | null {
  let s = t.replace(/[^\d,.-]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { data: me } = await admin.from('profiles').select('active').eq('id', user.id).single()
  if (!me?.active) return json({ error: 'Usuário inativo' }, 403)

  const plat = platClient()
  if (!plat) return json({ ok: false, error: 'Falta a chave do Essência Plat (segredo PLAT_SERVICE_KEY no Supabase do CRM).' })

  const b = await req.json().catch(() => ({}))
  // o card é lido com as permissões de quem está logado: só salva quem pode ver o negócio
  const { data: deal } = await userClient.from('deals').select('id, pipeline_id, stage_id, plat_sessao_id, meeting_files').eq('id', String(b.deal_id ?? '')).maybeSingle()
  if (!deal) return json({ ok: false, error: 'Negócio não encontrado.' })

  const d = b.dados ?? {}
  const dataIso = /^\d{4}-\d{2}-\d{2}$/.test(txt(d.data)) ? txt(d.data) : ''
  const lead = txt(d.lead, 200)
  if (!lead) return json({ ok: false, error: 'Informe o nome do lead.' })
  const valorTexto = txt(d.valor, 100)
  const registro = {
    data: dataIso, lead, whatsapp: txt(d.whatsapp, 40), vendedor: txt(d.vendedor, 80), produto: txt(d.produto, 80),
    upsell: d.upsell === true, formato: txt(d.formato, 80), presenca: txt(d.presenca, 40), resultado: txt(d.resultado, 40),
    valor: valorTexto, objecao1: txt(d.objecao1), objecao2: txt(d.objecao2), observacoes: txt(d.observacoes),
    contrato: txt(d.contrato, 1000), video: txt(d.video, 1000), transcricao: txt(d.transcricao, 1000),
  }
  const anexos = linksReuniao(Array.isArray(deal.meeting_files) ? deal.meeting_files : [])
  if (!registro.video) registro.video = anexos.video
  if (!registro.transcricao) registro.transcricao = anexos.transcricao

  // 1) Essência Plat
  const linha = {
    data_sessao: dataIso || null, data_texto: dataIso ? dataBR(dataIso) : null,
    lead_nome: lead, whatsapp: registro.whatsapp || null, vendedor: registro.vendedor || null, produto: registro.produto || null,
    upsell: registro.upsell, formato: registro.formato || null, presenca: registro.presenca || null, resultado: registro.resultado || null,
    valor_texto: valorTexto || null, valor_numerico: valorTexto ? valorNumero(valorTexto) : null,
    objecoes: ouPadrao(registro.objecao1, SEM_OBJECAO), objecoes2: ouPadrao(registro.objecao2, SEM_OBJECAO),
    observacoes: ouPadrao(registro.observacoes, SEM_OBSERVACAO),
    contrato_texto: registro.contrato || null, video_venda: registro.video || null, transcricao: registro.transcricao || null,
  }
  let platId: string | null = deal.plat_sessao_id ?? null
  let numero: number | null = null
  if (platId) {
    const { data: upd, error } = await plat.from('venda_sessoes').update(linha).eq('id', platId).select('id, numero').maybeSingle()
    if (error) return json({ ok: false, error: 'Essência Plat: ' + error.message })
    if (upd) numero = upd.numero
    else platId = null // a linha foi apagada lá: cria de novo
  }
  if (!platId) {
    const { data: ult } = await plat.from('venda_sessoes').select('numero').not('numero', 'is', null).order('numero', { ascending: false }).limit(1).maybeSingle()
    numero = (ult?.numero ?? 0) + 1
    const { data: ins, error } = await plat.from('venda_sessoes').insert({ ...linha, numero }).select('id, numero').single()
    if (error) return json({ ok: false, error: 'Essência Plat: ' + error.message })
    platId = ins.id
  }

  // 2) card do CRM (com as permissões de quem salvou, para o histórico registrar a pessoa)
  const agora = new Date().toISOString()
  const patch: Record<string, unknown> = { sessao_registro: registro, plat_sessao_id: platId, sessao_salva_em: agora, sessao_salva_por: user.id }

  // 3) coluna conforme o resultado
  const { data: etapas } = await admin.from('stages').select('id, name, kind').eq('pipeline_id', deal.pipeline_id)
  const porNome = (n: string) => (etapas ?? []).find((s: any) => s.name.toLowerCase() === n.toLowerCase())
  const destino = registro.presenca === 'No-show' ? porNome('Remarcar')
    : registro.resultado === 'Vendido' ? (etapas ?? []).find((s: any) => s.kind === 'won')
    : registro.resultado === 'Não vendido' ? porNome('Perdido apresentado')
    : undefined
  let movido: string | null = null
  if (destino && destino.id !== deal.stage_id) { patch.stage_id = destino.id; movido = destino.name }

  const { error: dErr } = await userClient.from('deals').update(patch).eq('id', deal.id)
  if (dErr) return json({ ok: false, error: 'Salvou no Essência Plat (nº ' + numero + '), mas não no card: ' + dErr.message })

  await admin.from('activities').insert({
    type: 'note', title: `Sessão 1:1 registrada (nº ${numero} no Essência Plat)`,
    description: [registro.presenca, registro.resultado, registro.produto, valorTexto].filter(Boolean).join(' · ') || null,
    deal_id: deal.id, done: true, done_at: agora, created_by: user.id, assigned_to: user.id,
  })

  return json({ ok: true, numero, plat_id: platId, movido, salvo_em: agora })
})
