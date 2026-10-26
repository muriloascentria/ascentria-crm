import { invokeFn } from './supabase'
import { meetingDateLabel, meetingTimeLabel } from './wa'

/** Chama a função "calendar" (Agenda Google das vendedoras). Lança erro com a mensagem pronta para o usuário. */
export async function callCalendar(action, body = {}) {
  const { data, error } = await invokeFn('calendar', { body: { action, ...body } })
  if (error) {
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* mantém a mensagem */ }
    throw new Error(msg)
  }
  if (data && data.ok === false) throw new Error(data.error || 'Falha na agenda')
  return data
}

/** "30/09 (qua) às 14h00" */
export const slotLabel = (s) => (s ? `${meetingDateLabel(s.date)} às ${meetingTimeLabel(s.time)}` : '')

const SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
/** "2026-10-13" → "Terça-feira (13/10)" (o dia da semana primeiro, como se fala com o lead) */
export function slotDia(date) {
  if (!date) return ''
  const [y, m, d] = date.split('-').map(Number)
  return `${SEMANA[new Date(y, m - 1, d).getDay()]} (${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')})`
}
/** "08:00" → "8h" ; "14:30" → "14:30h" */
export function slotHora(time) {
  if (!time) return ''
  const [h, mi = '00'] = time.split(':')
  return mi.slice(0, 2) === '00' ? `${Number(h)}h` : `${Number(h)}:${mi.slice(0, 2)}h`
}

/** Preenche [DIA 1] [HORA 1] [DIA 2] [HORA 2] com os horários oferecidos. */
export function fillSlots(text = '', slots = []) {
  let t = text
  slots.slice(0, 2).forEach((s, i) => {
    if (!s) return
    t = t.replace(new RegExp(`\\[DIA ${i + 1}\\]`, 'g'), slotDia(s.date)).replace(new RegExp(`\\[HORA ${i + 1}\\]`, 'g'), slotHora(s.time))
  })
  return t
}
