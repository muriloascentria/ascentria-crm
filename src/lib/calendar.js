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

/** Preenche [DIA 1] [HORA 1] [DIA 2] [HORA 2] com os horários oferecidos. */
export function fillSlots(text = '', slots = []) {
  let t = text
  slots.slice(0, 2).forEach((s, i) => {
    if (!s) return
    t = t.replace(new RegExp(`\\[DIA ${i + 1}\\]`, 'g'), meetingDateLabel(s.date)).replace(new RegExp(`\\[HORA ${i + 1}\\]`, 'g'), meetingTimeLabel(s.time))
  })
  return t
}
