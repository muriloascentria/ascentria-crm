// Webhook da WhatsApp Cloud API.
//  GET  → verificação inicial feita pela Meta (hub.challenge)
//  POST → mensagens recebidas e status de entrega
//
// Secrets necessários (Supabase → Edge Functions → Secrets):
//  WA_VERIFY_TOKEN  — palavra secreta que você digita no painel da Meta
//  WA_APP_SECRET    — "App Secret" do app na Meta (valida a assinatura; sem ele o webhook recusa tudo)
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — já existem por padrão
import { createClient } from 'npm:@supabase/supabase-js@2'
import { json, safeEqual, verifySignature } from '../_shared/wa.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token') ?? ''
    const challenge = url.searchParams.get('hub.challenge')
    const expected = Deno.env.get('WA_VERIFY_TOKEN') ?? ''
    if (mode === 'subscribe' && expected && safeEqual(token, expected)) {
      return new Response(challenge ?? '', { status: 200 })
    }
    return new Response('Token de verificação inválido', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  if (raw.length > 1_000_000) return new Response('Payload grande demais', { status: 413 })
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256')))) {
    return new Response('Assinatura inválida', { status: 401 })
  }

  let payload: any
  try { payload = JSON.parse(raw) } catch { return json({ ok: false, error: 'JSON inválido' }, 400) }

  // A Meta envia eventos de TODOS os números da conta (WABA). Só processamos os números cadastrados
  // no CRM — os demais podem estar em uso por outro sistema (ex.: Go High Level).
  const { data: nums } = await supabase.from('wa_numbers').select('phone_number_id').eq('active', true)
  const known = new Set((nums ?? []).map((n: { phone_number_id: string }) => n.phone_number_id))

  const results: unknown[] = []
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value
      if (!value) continue
      const profileName: string = value.contacts?.[0]?.profile?.name ?? ''
      const phoneNumberId: string | null = value.metadata?.phone_number_id ?? null
      if (phoneNumberId && !known.has(phoneNumberId)) { results.push({ ignored: phoneNumberId }); continue }

      for (const m of value.messages ?? []) {
        const body = extractBody(m)
        const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString()
        const { data, error } = await supabase.rpc('wa_inbound', {
          p_wa_id: m.from, p_wa_name: profileName, p_message_id: m.id, p_type: m.type ?? 'text',
          p_body: body, p_raw: m, p_ts: ts, p_phone_number_id: phoneNumberId,
        })
        results.push(error ? { error: error.message } : data)
      }

      for (const s of value.statuses ?? []) {
        await supabase.from('wa_messages').update({ status: s.status, error: s.errors?.[0]?.title ?? null })
          .eq('wa_message_id', s.id)
      }
    }
  }

  // A Meta exige 200 rápido; qualquer outra resposta faz ela reenviar.
  return json({ ok: true, results })
})

function extractBody(m: any): string {
  switch (m.type) {
    case 'text': return m.text?.body ?? ''
    case 'button': return m.button?.text ?? ''
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''
    case 'image': case 'video': case 'document': return m[m.type]?.caption ? `[${m.type}] ${m[m.type].caption}` : `[${m.type}]`
    case 'audio': return '[áudio]'
    case 'sticker': return '[figurinha]'
    case 'location': return `[localização] ${m.location?.latitude},${m.location?.longitude}`
    case 'contacts': return '[contato compartilhado]'
    case 'reaction': return `[reação] ${m.reaction?.emoji ?? ''}`
    default: return `[${m.type}]`
  }
}
