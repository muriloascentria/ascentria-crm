// Cliente mínimo da WhatsApp Cloud API (Meta Graph API)
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages

export const GRAPH_VERSION = Deno.env.get('WA_GRAPH_VERSION') ?? 'v21.0'

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`)
  return v
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string }

async function post(payload: Record<string, unknown>, phoneNumberId?: string | null): Promise<SendResult> {
  let token: string
  try { phoneNumberId = phoneNumberId || env('WA_PHONE_NUMBER_ID'); token = env('WA_ACCESS_TOKEN') }
  catch (e) { return { ok: false, error: (e as Error).message } }
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`
    return { ok: false, error: msg }
  }
  return { ok: true, id: json?.messages?.[0]?.id ?? '' }
}

/** Texto livre — só funciona dentro da janela de 24h após a última mensagem do lead. */
export function sendText(to: string, body: string, phoneNumberId?: string | null) {
  return post({ to, type: 'text', text: { preview_url: false, body } }, phoneNumberId)
}

/** Template aprovado na Meta — funciona a qualquer momento. params preenchem {{1}}, {{2}}… do corpo. */
export function sendTemplate(to: string, name: string, lang = 'pt_BR', params: string[] = [], phoneNumberId?: string | null) {
  const components = params.length
    ? [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p) })) }]
    : []
  return post({ to, type: 'template', template: { name, language: { code: lang }, components } }, phoneNumberId)
}

/**
 * Pergunta com opções (mensagem interativa) — só dentro da janela de 24h.
 * 1 a 3 opções → botões de resposta rápida (título até 20 caracteres);
 * 4 a 10 opções → lista (título da linha até 24 caracteres).
 */
export function sendInteractive(to: string, body: string, options: string[], phoneNumberId?: string | null) {
  const opts = options.map((o) => String(o).trim()).filter(Boolean).slice(0, 10)
  const interactive = opts.length <= 3
    ? {
        type: 'button',
        body: { text: body.slice(0, 1024) },
        action: { buttons: opts.map((o, i) => ({ type: 'reply', reply: { id: `opt_${i + 1}`, title: o.slice(0, 20) } })) },
      }
    : {
        type: 'list',
        body: { text: body.slice(0, 4096) },
        action: {
          button: 'Ver opções',
          sections: [{ title: 'Opções', rows: opts.map((o, i) => ({ id: `opt_${i + 1}`, title: o.slice(0, 24) })) }],
        },
      }
  return post({ to, type: 'interactive', interactive }, phoneNumberId)
}

/** Resolve o phone_number_id de um número cadastrado (wa_numbers.id → phone_number_id). */
export async function resolveNumber(admin: any, waNumberId?: string | null): Promise<string | null> {
  if (waNumberId) {
    const { data } = await admin.from('wa_numbers').select('phone_number_id').eq('id', waNumberId).single()
    if (data?.phone_number_id && data.phone_number_id !== 'CONFIGURE-NO-PAINEL') return data.phone_number_id
  }
  const { data } = await admin.from('wa_numbers').select('phone_number_id').eq('active', true).order('is_default', { ascending: false }).limit(1)
  const id = data?.[0]?.phone_number_id
  return id && id !== 'CONFIGURE-NO-PAINEL' ? id : null
}

/** Valida a assinatura X-Hub-Signature-256 do webhook (se WA_APP_SECRET estiver definido). */
export async function verifySignature(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('WA_APP_SECRET')
  if (!secret) return true // sem segredo configurado: não valida (não recomendado em produção)
  if (!header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === header.slice(7)
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } })

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
