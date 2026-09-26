import { supabase, DEMO } from './supabase'

export const STAGE_ROLES = {
  '': 'Coluna comum',
  inbox: 'Recebidos (entrada automática; passagem manual para o Dia 1)',
  day: 'Dia da sequência (mensagem + avanço automático)',
  responsive: 'Responsivo (lead respondeu)',
  archived: 'Arquivado (aguarda reativação)',
  reactivate: 'Reativar (opcional: coluna manual em vez de voltar ao Dia 1)',
}

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
