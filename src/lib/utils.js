export const fmtMoney = (v, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(v || 0))

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export const relativeDay = (d) => {
  if (!d) return ''
  const date = new Date(d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(date).setHours(0, 0, 0, 0) - today) / 86400000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  if (diff === -1) return 'Ontem'
  if (diff < 0) return `${-diff} dias atrás`
  return `em ${diff} dias`
}

export const toLocalInput = (d) => {
  if (!d) return ''
  const x = new Date(d)
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset())
  return x.toISOString().slice(0, 16)
}

export const initials = (name = '') =>
  name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?'

export const slugify = (s = '') =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export const ACTIVITY_TYPES = {
  task: { label: 'Tarefa', icon: '☑' },
  call: { label: 'Ligação', icon: '☎' },
  meeting: { label: 'Reunião', icon: '📅' },
  email: { label: 'E-mail', icon: '✉' },
  whatsapp: { label: 'WhatsApp', icon: '💬' },
  note: { label: 'Nota', icon: '✎' },
}

export const ROLES = { admin: 'Administrador', manager: 'Gestor', seller: 'Vendedor' }

export const SOURCES = ['Indicação', 'Instagram', 'Site', 'WhatsApp', 'Evento', 'Anúncio', 'Outro']
