import { supabase, DEMO } from './supabase'

export const STAGE_ROLES = {
  '': 'Coluna comum',
  inbox: 'Recebidos (entrada automática; passagem manual para o Dia 1)',
  day: 'Dia da sequência (mensagem + avanço automático)',
  responsive: 'Responsivo (lead respondeu)',
  archived: 'Perdido temporário (volta ao Dia 1 após o prazo)',
  reactivate: 'Reativar (opcional: coluna manual em vez de voltar ao Dia 1)',
}

/** Etapas das mensagens prontas (a ordem aqui é a ordem do menu). */
export const QUICK_STAGES = [['agendamento', 'Agendamento'], ['qualificacao', 'Qualificação'], ['confirmacao', 'Confirmação'], ['remarcacao', 'Remarcação']]
/** Etapas usadas só quando acontece algo (cancelamento): ficam fora da "próxima mensagem" sugerida. */
export const SITUATIONAL_STAGES = ['remarcacao']
export const quickStageLabel = (s) => (QUICK_STAGES.find(([k]) => k === s) || [null, 'Outras'])[1]

/** Uma mensagem pronta pode ter várias mensagens separadas por uma linha com "---". */
export const splitParts = (body = '') => body.split(/\n[ \t]*---[ \t]*(?:\n|$)/).map((t) => t.trim()).filter(Boolean)

/** Campos que quem envia precisa preencher, escritos em maiúsculas entre colchetes: [DATA], [HORA 1]... */
export const pendingFields = (text = '') => [...new Set(text.match(/\[[A-ZÀ-Ú0-9 ]+\]/g) || [])]

export const functionsUrl = () => (DEMO ? 'https://SEU-PROJETO.supabase.co/functions/v1' : `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`)

export const webhookUrl = () => `${functionsUrl()}/whatsapp-webhook`
export const instagramWebhookUrl = () => `${functionsUrl()}/instagram-webhook`

/** Demo: simula uma DM do Instagram com número (só no modo demonstração). */
export async function simulateInstagramDM(text) {
  const { data, error } = await supabase.functions.invoke('demo-instagram', { body: { text } })
  if (error) throw new Error(error.message)
  return data
}

/** Envia mensagem pelo WhatsApp via Edge Function (texto na janela de 24h, template fora dela). */
export async function sendWhatsApp(payload) {
  const { data, error } = await supabase.functions.invoke('whatsapp-send', { body: payload })
  if (error) throw new Error(await describeError(error))
  if (data && data.ok === false) throw new Error(data.error || 'Falha no envio')
  return data
}

/** Verifica o token da Meta e inscreve o app nos webhooks da conta do WhatsApp (admin). */
export async function connectWaba(wabaId) {
  const { data, error } = await supabase.functions.invoke('wa-connect', { body: { waba_id: String(wabaId).trim() } })
  if (error) throw new Error(await describeError(error))
  return data
}

/** Registra um número na Cloud API com o PIN de 6 dígitos da verificação em duas etapas (admin). */
export async function registerNumber(phoneNumberId, pin) {
  const { data, error } = await supabase.functions.invoke('wa-connect', { body: { action: 'register', phone_number_id: String(phoneNumberId), pin: String(pin).trim() } })
  if (error) throw new Error(await describeError(error))
  return data
}

/** Reverificação do número: pede código por SMS/ligação (request_code) e confirma (verify_code). */
export async function verifyNumberStep(action, phoneNumberId, extra = {}) {
  const { data, error } = await supabase.functions.invoke('wa-connect', { body: { action, phone_number_id: String(phoneNumberId), ...extra } })
  if (error) throw new Error(await describeError(error))
  return data
}

/** Roda o motor da cadência agora (admin). */
export async function runCadenceNow() {
  const { data, error } = await supabase.functions.invoke('cadence-run', { body: {} })
  if (error) throw new Error(await describeError(error))
  return data
}

async function describeError(error) {
  try {
    const body = await error.context?.json?.()
    if (body?.error) return body.error
  } catch { /* ignore */ }
  return error.message || 'Erro ao chamar a função'
}

export const inWindow = (deal) => !!deal?.last_inbound_at && Date.now() - new Date(deal.last_inbound_at).getTime() < 24 * 3600 * 1000

export const daysIn = (ts) => (ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : 0)

/** Move os N leads mais antigos de "Recebidos" para o Dia 1. */
export async function moveInboxToDay1(pipelineId, count) {
  const { data, error } = await supabase.rpc('move_inbox_to_day1', { p_pipeline: pipelineId, p_count: count })
  if (error) throw new Error(error.message)
  return data
}
/** Conversas iniciadas pela empresa (templates) nas últimas 24h. */
export async function sentLast24h() {
  const { data } = await supabase.rpc('sent_last_24h')
  return data ?? 0
}

/* ------------------------------------------------------------------------------------------
   Encontro confirmado: dia, hora e link guardados no negócio. Quem envia preenche uma vez e
   os campos [DATA], [HORA], [HOJE OU AMANHÃ] e [LINK] das mensagens prontas saem preenchidos.
   ------------------------------------------------------------------------------------------ */
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

/** "2026-09-29" → "29/09 (segunda-feira)" */
export function meetingDateLabel(date) {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  const dia = new Date(y, m - 1, d)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${DIAS_SEMANA[dia.getDay()]})`
}

/** "09:30" → "9h30", "14:00" → "14h00" */
export function meetingTimeLabel(time) {
  if (!time) return ''
  const [h, mi] = time.split(':')
  return `${Number(h)}h${(mi || '00').slice(0, 2)}`
}

/** "hoje", "amanhã" ou "no dia 29/09", conforme a data do encontro em relação a agora. */
export function meetingWhen(date, now = new Date()) {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  const alvo = new Date(y, m - 1, d)
  const hoje = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dias = Math.round((alvo - hoje) / 86400000)
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'amanhã'
  return `no dia ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

/** Troca os campos do encontro que já estiverem preenchidos; os outros continuam entre colchetes. */
export function fillMeeting(text = '', meeting = {}) {
  let t = text
  if (meeting.date) {
    t = t.replace(/\[(DATA|DIA)\]/g, meetingDateLabel(meeting.date))
    const quando = meetingWhen(meeting.date)
    // No começo de uma linha a palavra ganha maiúscula ("Amanhã, antes do horário...").
    t = t.replace(/(^|\n)\[HOJE OU AMANHÃ\]/g, (_, ini) => ini + quando.charAt(0).toUpperCase() + quando.slice(1))
    t = t.replace(/\[HOJE OU AMANHÃ\]/g, quando)
  }
  if (meeting.time) t = t.replace(/\[HORA\]/g, meetingTimeLabel(meeting.time))
  if (meeting.link) t = t.replace(/\[LINK\]/g, meeting.link.trim())
  return t
}
