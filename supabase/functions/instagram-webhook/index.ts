// Webhook do Instagram (Messenger Platform / Instagram Messaging API).
//  GET  → verificação inicial feita pela Meta (hub.challenge)
//  POST → mensagens recebidas no direct da conta profissional
//
// Regra de negócio: quando a mensagem contém um número de celular, o lead entra
// no funil de cadência (Dia 1) e recebe a primeira mensagem pelo WhatsApp.
//
// Secrets: WA_VERIFY_TOKEN (o mesmo do WhatsApp), WA_APP_SECRET (mesmo app),
//          IG_ACCESS_TOKEN (token da Página/Instagram, opcional — usado só para buscar nome e @username)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { GRAPH_VERSION, json, verifySignature } from '../_shared/wa.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('WA_VERIFY_TOKEN')) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('Token de verificação inválido', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('Assinatura inválida', { status: 401 })

  let payload: any
  try { payload = JSON.parse(raw) } catch { return json({ ok: false, error: 'JSON inválido' }, 400) }
  if (payload?.object !== 'instagram') return json({ ok: true, ignored: payload?.object })

  const results: unknown[] = []
  for (const entry of payload.entry ?? []) {
    // formato "messaging" (Instagram Messaging API)
    for (const ev of entry.messaging ?? []) {
      const msg = ev.message
      if (!msg || msg.is_echo) continue                 // ignora ecos das nossas próprias respostas
      const senderId: string = ev.sender?.id
      if (!senderId || senderId === entry.id) continue  // mensagem enviada pela própria conta
      const text: string = msg.text ?? (msg.attachments?.length ? `[${msg.attachments[0].type}]` : '')
      const profile = await fetchProfile(senderId)
      const ts = ev.timestamp ? new Date(Number(ev.timestamp)).toISOString() : new Date().toISOString()
      const { data, error } = await supabase.rpc('ig_inbound', {
        p_ig_id: senderId, p_username: profile.username, p_name: profile.name, p_message_id: msg.mid ?? null,
        p_text: text, p_raw: ev, p_ts: ts,
      })
      results.push(error ? { error: error.message } : data)
    }
    // formato "changes" (Instagram API with Instagram Login) — mesmo conteúdo em outro envelope
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue
      const v = change.value ?? {}
      const msg = v.message
      if (!msg || msg.is_echo) continue
      const senderId: string = v.sender?.id
      if (!senderId) continue
      const profile = await fetchProfile(senderId)
      const { data, error } = await supabase.rpc('ig_inbound', {
        p_ig_id: senderId, p_username: profile.username, p_name: profile.name, p_message_id: msg.mid ?? null,
        p_text: msg.text ?? '', p_raw: v, p_ts: new Date().toISOString(),
      })
      results.push(error ? { error: error.message } : data)
    }
  }
  return json({ ok: true, results })
})

async function fetchProfile(igsid: string): Promise<{ name: string | null; username: string | null }> {
  const token = Deno.env.get('IG_ACCESS_TOKEN')
  if (!token) return { name: null, username: null }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${igsid}?fields=name,username&access_token=${token}`)
    if (!res.ok) return { name: null, username: null }
    const j = await res.json()
    return { name: j.name ?? null, username: j.username ?? null }
  } catch { return { name: null, username: null } }
}
