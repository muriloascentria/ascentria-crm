// Agenda Google das vendedoras (Google Workspace da empresa).
// Uma conta de serviço do Google com "delegação em todo o domínio" age em nome de cada vendedora,
// só com o escopo de eventos da agenda (calendar.events).
//
// Ações (body.action):
//   status  (admin)         → testa o acesso à agenda de cada vendedora cadastrada
//   slots   { seller_id, deal_id? } → próximos blocos com o título de disponibilidade (até 8)
//                             e, com deal_id, grava no negócio quais horários foram oferecidos
//   book    { deal_id, seller_id, event_id } → reserva o bloco: renomeia para "Vendedora | Consultoria | Nome",
//                             cria o Google Meet e preenche o Encontro confirmado do negócio
//   release { deal_id }     → desfaz a reserva: o bloco volta a ser "disponível" e o encontro é apagado
//   transfer { deal_id, from_seller_id, to_seller_id, dry_run? } → passa o encontro para outra vendedora no
//                             mesmo horário (acha também encontros marcados direto na agenda, pelo nome do lead)
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (o arquivo .json da conta de serviço, inteiro)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/wa.ts'

const TZ = 'America/Sao_Paulo'
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

type SA = { client_email: string; private_key: string; token_uri?: string }

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleToken(sa: SA, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, sub: subject, scope: SCOPE, aud, iat: now, exp: now + 3600 }))}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = String(data.error_description || data.error || res.status)
    if (/unauthorized_client/i.test(e) || /not authorized/i.test(e)) throw new Error('A conta de serviço ainda não foi autorizada no Google Workspace (delegação em todo o domínio).')
    if (/invalid_grant/i.test(e)) throw new Error(`O Google não reconheceu a agenda de ${subject}. Confira o e-mail da vendedora.`)
    throw new Error('Google: ' + e)
  }
  return data.access_token
}

async function gcal(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(res.status === 404 ? 'Evento não encontrado na agenda.' : 'Google Agenda: ' + (data?.error?.message || res.status))
  return data
}

const norm = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ')

function spParts(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
  if (!me?.active) return json({ error: 'Usuário inativo' }, 403)

  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  let sa: SA | null = null
  try { sa = raw ? JSON.parse(raw) : null } catch { sa = null }
  if (!sa?.client_email || !sa?.private_key) return json({ ok: false, error: 'A agenda Google ainda não foi conectada (falta a chave da conta de serviço no Supabase).' })

  const b = await req.json().catch(() => ({}))
  const { data: settings } = await admin.from('org_settings').select('slot_title').eq('id', 1).single()
  const TITLE = settings?.slot_title || 'DISPONÍVEL PARA AGENDAMENTO'

  const seller = async (id: string) => {
    const { data } = await admin.from('calendar_sellers').select('id, name, email, active').eq('id', id).maybeSingle()
    if (!data?.active) throw new Error('Vendedora não encontrada ou inativa.')
    return data
  }
  // O negócio precisa ser visível para quem pede (regras de acesso do banco).
  const dealFor = async (id: string) => {
    const { data } = await userClient.from('deals').select('id, title, seller_id, calendar_event_id, contact:contacts(name, phone, wa_id)').eq('id', id).maybeSingle()
    if (!data) throw new Error('Negócio não encontrado.')
    return data as any
  }

  try {
    if (b.action === 'status') {
      if (me.role !== 'admin') return json({ error: 'Apenas administradores' }, 403)
      const { data: list } = await admin.from('calendar_sellers').select('id, name, email').eq('active', true).order('position')
      const out = []
      for (const s of list ?? []) {
        try {
          const tk = await googleToken(sa, s.email)
          const r = await gcal(tk, `?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(new Date().toISOString())}&q=${encodeURIComponent(TITLE)}`)
          out.push({ name: s.name, email: s.email, ok: true, free: (r.items ?? []).filter((e: any) => norm(e.summary) === norm(TITLE)).length })
        } catch (e) { out.push({ name: s.name, email: s.email, ok: false, error: (e as Error).message }) }
      }
      return json({ ok: true, service_account: sa.client_email, sellers: out })
    }

    if (b.action === 'slots') {
      const s = await seller(b.seller_id)
      const tk = await googleToken(sa, s.email)
      const from = new Date(Date.now() + 30 * 60_000).toISOString()
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString()
      const r = await gcal(tk, `?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}&q=${encodeURIComponent(TITLE)}`)
      const slots = (r.items ?? [])
        .filter((e: any) => norm(e.summary) === norm(TITLE) && e.start?.dateTime && e.status !== 'cancelled')
        .slice(0, 8)
        .map((e: any) => ({ event_id: e.id, seller_id: s.id, start: e.start.dateTime, end: e.end?.dateTime, ...spParts(e.start.dateTime) }))
      if (b.deal_id && Array.isArray(b.offer)) {
        // grava os horários oferecidos ao lead (para reservar depois com um clique)
        await dealFor(b.deal_id)
        const offered = slots.filter((x: any) => b.offer.includes(x.event_id))
        await admin.from('deals').update({ seller_id: s.id, offered_slots: offered }).eq('id', b.deal_id)
      }
      return json({ ok: true, seller: s.name, slots })
    }

    if (b.action === 'offer') {
      // só grava a escolha dos horários oferecidos (sem consultar o Google de novo)
      await dealFor(b.deal_id)
      const offered = (Array.isArray(b.slots) ? b.slots : []).slice(0, 4).map((x: any) => ({ event_id: String(x.event_id), seller_id: String(x.seller_id), start: String(x.start), end: x.end ? String(x.end) : null, date: String(x.date), time: String(x.time) }))
      await admin.from('deals').update({ seller_id: offered[0]?.seller_id ?? null, offered_slots: offered }).eq('id', b.deal_id)
      return json({ ok: true })
    }

    if (b.action === 'book') {
      const deal = await dealFor(b.deal_id)
      const s = await seller(b.seller_id)
      const tk = await googleToken(sa, s.email)
      // se o negócio já tinha outro horário reservado, libera o anterior
      if (deal.calendar_event_id && deal.calendar_event_id !== b.event_id && deal.seller_id) {
        try {
          const old = await seller(deal.seller_id)
          const tkOld = old.email === s.email ? tk : await googleToken(sa, old.email)
          await gcal(tkOld, `/${encodeURIComponent(deal.calendar_event_id)}?conferenceDataVersion=1`, { method: 'PATCH', body: JSON.stringify({ summary: TITLE, description: '', conferenceData: null }) })
        } catch { /* o anterior pode ter sido apagado na agenda; segue */ }
      }
      const ev = await gcal(tk, `/${encodeURIComponent(b.event_id)}`)
      if (norm(ev.summary) !== norm(TITLE) && ev.id !== deal.calendar_event_id) return json({ ok: false, error: 'Esse horário já foi reservado por outra pessoa. Busque os horários de novo.' })
      const nome = deal.contact?.name || deal.title
      const fone = deal.contact?.wa_id ? '+' + deal.contact.wa_id : (deal.contact?.phone || '')
      const patched = await gcal(tk, `/${encodeURIComponent(b.event_id)}?conferenceDataVersion=1`, {
        method: 'PATCH',
        body: JSON.stringify({
          summary: `${s.name} | Consultoria | ${nome}`,
          description: `Lead: ${nome}\nWhatsApp: ${fone}\nAgendado pelo eCRM (https://ecrm.digital)`,
          conferenceData: ev.conferenceData ?? { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        }),
      })
      const link = patched.hangoutLink || patched.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === 'video')?.uri || null
      const when = spParts(patched.start.dateTime)
      await admin.from('deals').update({ seller_id: s.id, calendar_event_id: patched.id, meeting_date: when.date, meeting_time: when.time, meeting_link: link }).eq('id', deal.id)
      return json({ ok: true, date: when.date, time: when.time, link, seller: s.name })
    }

    if (b.action === 'release') {
      const deal = await dealFor(b.deal_id)
      if (deal.calendar_event_id && deal.seller_id) {
        const s = await seller(deal.seller_id)
        const tk = await googleToken(sa, s.email)
        await gcal(tk, `/${encodeURIComponent(deal.calendar_event_id)}?conferenceDataVersion=1`, { method: 'PATCH', body: JSON.stringify({ summary: TITLE, description: '', conferenceData: null }) })
      }
      await admin.from('deals').update({ calendar_event_id: null, meeting_date: null, meeting_time: null, meeting_link: null }).eq('id', deal.id)
      return json({ ok: true })
    }

    if (b.action === 'transfer') {
      // Passa o encontro para outra vendedora no MESMO horário.
      // Acha o evento pelo calendar_event_id do negócio ou, se foi marcado direto na agenda, pelo nome do lead.
      const deal = await dealFor(b.deal_id)
      const fromId = b.from_seller_id || deal.seller_id
      if (!fromId) return json({ ok: false, error: 'Não sei em qual agenda o encontro está.' })
      const from = await seller(fromId)
      const to = await seller(b.to_seller_id)
      if (from.id === to.id) return json({ ok: false, error: 'O encontro já está na agenda dessa vendedora.' })
      const tkFrom = await googleToken(sa, from.email)
      const nome = deal.contact?.name || deal.title
      let ev: any = null
      if (deal.calendar_event_id && deal.seller_id === from.id) ev = await gcal(tkFrom, `/${encodeURIComponent(deal.calendar_event_id)}`).catch(() => null)
      if (!ev) {
        const words = norm(nome).split(' ').filter((w) => w.length > 2)
        const key = (w: string) => w.replace(/Z/g, 'S') // Luiz / Luis
        const r = await gcal(tkFrom, `?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&timeMax=${encodeURIComponent(new Date(Date.now() + 90 * 86_400_000).toISOString())}`)
        const found = (r.items ?? []).filter((e: any) => e.status !== 'cancelled' && e.start?.dateTime && norm(e.summary) !== norm(TITLE)
          && words.filter((w) => key(norm(`${e.summary} ${e.description ?? ''}`)).includes(key(w))).length >= Math.min(2, words.length))
        if (!found.length) return json({ ok: false, error: `Não achei o encontro de ${nome} na agenda de ${from.name}.` })
        if (found.length > 1) return json({ ok: false, error: 'Achei mais de um encontro com esse nome.', candidates: found.map((e: any) => ({ id: e.id, summary: e.summary, ...spParts(e.start.dateTime) })) })
        ev = found[0]
      }
      const when = spParts(ev.start.dateTime)
      if (b.dry_run) return json({ ok: true, dry_run: true, from: from.name, to: to.name, event: { id: ev.id, summary: ev.summary, ...when, end: ev.end?.dateTime } })

      const tkTo = await googleToken(sa, to.email)
      const fone = deal.contact?.wa_id ? '+' + deal.contact.wa_id : (deal.contact?.phone || '')
      const body = {
        summary: `${to.name} | Consultoria | ${nome}`,
        description: `Lead: ${nome}\nWhatsApp: ${fone}\nAgendado pelo eCRM (https://ecrm.digital)`,
      }
      // usa o bloco "disponível" da nova vendedora que começa no mesmo horário; se não tiver, cria o evento
      const r2 = await gcal(tkTo, `?singleEvents=true&timeMin=${encodeURIComponent(new Date(new Date(ev.start.dateTime).getTime() - 60_000).toISOString())}&timeMax=${encodeURIComponent(new Date(new Date(ev.start.dateTime).getTime() + 60_000).toISOString())}`)
      const same = (r2.items ?? []).find((e: any) => norm(e.summary) === norm(TITLE) && e.start?.dateTime && new Date(e.start.dateTime).getTime() === new Date(ev.start.dateTime).getTime())
      const conf = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
      // convidados do evento antigo (ex.: e-mail do lead) vão junto, sem a vendedora anterior
      const guests = (ev.attendees ?? []).filter((a: any) => !a.self && !a.organizer && norm(a.email) !== norm(from.email)).map((a: any) => ({ email: a.email }))
      const extra = guests.length ? { attendees: guests } : {}
      const created = same
        ? await gcal(tkTo, `/${encodeURIComponent(same.id)}?conferenceDataVersion=1&sendUpdates=none`, { method: 'PATCH', body: JSON.stringify({ ...body, ...extra, conferenceData: same.conferenceData ?? conf }) })
        : await gcal(tkTo, `?conferenceDataVersion=1&sendUpdates=none`, { method: 'POST', body: JSON.stringify({ ...body, ...extra, start: ev.start, end: ev.end, conferenceData: conf }) })

      // a agenda antiga: o horário volta a ficar disponível
      await gcal(tkFrom, `/${encodeURIComponent(ev.id)}?conferenceDataVersion=1&sendUpdates=none`, { method: 'PATCH', body: JSON.stringify({ summary: TITLE, description: '', conferenceData: null, ...(guests.length ? { attendees: [] } : {}) }) })

      const link = created.hangoutLink || created.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === 'video')?.uri || null
      await admin.from('deals').update({ seller_id: to.id, calendar_event_id: created.id, meeting_date: when.date, meeting_time: when.time, meeting_link: link }).eq('id', deal.id)
      return json({ ok: true, from: from.name, to: to.name, date: when.date, time: when.time, link, reused_free_slot: !!same })
    }

    return json({ ok: false, error: 'Ação desconhecida' }, 400)
  } catch (e) {
    console.error('calendar', b.action, (e as Error).message)
    return json({ ok: false, error: (e as Error).message })
  }
})
