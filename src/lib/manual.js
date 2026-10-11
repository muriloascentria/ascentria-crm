import { supabase } from './supabase'

/* ------------------------------------------------------------------------------------------
   WhatsApp em modo manual: o CRM organiza a sequência e prepara o texto; quem envia é a equipe,
   pelo WhatsApp dela (link wa.me abre a conversa já com a mensagem escrita).
   ------------------------------------------------------------------------------------------ */

export const isManual = (settings) => settings?.wa_mode === 'manual'

/** Só os dígitos do telefone, com 55 na frente quando vier sem o código do país. */
export function phoneDigits(contact) {
  let d = String(contact?.wa_id || contact?.phone || '').replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) d = '55' + d
  return d
}

const noCelular = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** Onde abrir no computador: 'app' (WhatsApp instalado no computador) ou 'web' (WhatsApp Web). Fica salvo neste navegador. */
const PREF = 'waAbrirEm'
export const getAbrirEm = () => { try { return localStorage.getItem(PREF) || 'web' } catch { return 'web' } }
export const setAbrirEm = (v) => { try { localStorage.setItem(PREF, v) } catch { /* sem armazenamento: vale só agora */ } }
export const ehCelular = noCelular

/** Link que abre a conversa com o texto pronto: no celular, o app; no computador, o app instalado ou o WhatsApp Web. */
export const waLink = (contact, text) => {
  const d = phoneDigits(contact)
  if (!d) return ''
  const t = encodeURIComponent(text || '')
  if (noCelular()) return `https://wa.me/${d}?text=${t}`
  return getAbrirEm() === 'app' ? `whatsapp://send?phone=${d}&text=${t}` : `https://web.whatsapp.com/send?phone=${d}&text=${t}`
}

/** Abre o link. App do computador: abre na janela do WhatsApp que já está aberta (sem aba nova).
 *  WhatsApp Web: usa sempre a MESMA aba (a que o CRM abriu), sem abrir uma aba nova a cada lead. */
export const abrirWhatsApp = (link) => {
  if (link.startsWith('whatsapp:')) { window.location.href = link; return }
  window.open(link, noCelular() ? '_blank' : 'crm-whatsapp')
}

export const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || ''

/** Texto da mensagem da coluna (Dia 1…Dia 5) com o primeiro nome do lead. */
export const stageText = (stage, name) =>
  String(stage?.message_text || '').replace(/{{\s*(primeiro_nome|nome)\s*}}/g, firstName(name))

/** Coluna cuja mensagem vale para o card: Recebidos usa a do Dia 1. */
export function messageStage(deal, stages) {
  const st = stages.find((s) => s.id === deal?.stage_id)
  if (!st) return null
  if (st.role === 'day') return st
  if (st.role === 'inbox') return stages.filter((s) => s.pipeline_id === st.pipeline_id && s.role === 'day').sort((a, b) => a.position - b.position)[0] || null
  return null
}

/** Pode receber a mensagem da sequência? (pediu para sair ou é da lista antiga sem autorização → não) */
export function podeReceber(contact) {
  if (!contact) return false
  if (contact.marketing_opt_out) return false
  if (contact.source === 'CRM antigo' && !contact.optin) return false
  return !!phoneDigits(contact)
}

/** Card esperando a mensagem do dia (ainda não enviada nesta coluna). */
export function precisaContato(deal, stages) {
  const st = stages.find((s) => s.id === deal?.stage_id)
  if (!st || deal.status !== 'open' || !['inbox', 'day'].includes(st.role)) return false
  const alvo = messageStage(deal, stages)
  if (!alvo) return false
  return deal.manual_sent_stage !== alvo.id
}

/** Quem precisa receber a mensagem da sequência hoje (deals com contact embutido). */
export const devidos = (deals, stages) => deals.filter((d) => precisaContato(d, stages) && podeReceber(d.contact))

/** Marca a mensagem do dia como enviada. Card em Recebidos passa para o Dia 1. Devolve a coluna do card. */
export async function marcarEnviado(deal, stages, profileId) {
  const alvo = messageStage(deal, stages)
  if (!alvo) throw new Error('Este card não está numa coluna da sequência.')
  const agora = new Date().toISOString()
  const { error } = await supabase.from('deals').update({ stage_id: alvo.id, manual_sent_stage: alvo.id, manual_sent_at: agora }).eq('id', deal.id)
  if (error) throw error
  await supabase.from('activities').insert({
    type: 'whatsapp', title: `Mensagem do ${alvo.name} enviada pelo WhatsApp`, description: null,
    due_at: agora, done: true, done_at: agora, deal_id: deal.id, contact_id: deal.contact_id || null,
    assigned_to: profileId || null, created_by: profileId || null,
  })
  return alvo.id
}

/** Desfaz a marcação de enviada (o card continua na coluna em que está). */
export async function desfazerEnviado(dealId) {
  const { error } = await supabase.from('deals').update({ manual_sent_stage: null, manual_sent_at: null }).eq('id', dealId)
  if (error) throw error
}

/** O lead respondeu no WhatsApp: card vai para Responsivo (e fica lá até alguém mover). */
export async function marcarRespondeu(deal, stages) {
  const resp = stages.find((s) => s.pipeline_id === deal.pipeline_id && s.role === 'responsive')
  if (!resp) throw new Error('Este funil não tem a coluna Responsivo.')
  const { error } = await supabase.from('deals').update({ stage_id: resp.id }).eq('id', deal.id)
  if (error) throw error
  return resp.id
}
