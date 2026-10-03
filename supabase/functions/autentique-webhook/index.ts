// Avisos da Autentique (webhook): a cada assinatura, recusa ou documento finalizado, atualiza o card do lead.
// Configurado no painel de desenvolvedor da Autentique apontando para esta função.
// Secrets: AUTENTIQUE_WEBHOOK_SECRET (para conferir a assinatura x-autentique-signature), AUTENTIQUE_TOKEN
import { createClient } from 'npm:@supabase/supabase-js@2'
import { safeEqual } from '../_shared/wa.ts'
import { aplicarAndamento, buscarDocumento } from '../_shared/autentique.ts'

const ok = (body: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function hmacHex(secret: string, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok({ ok: true, info: 'webhook da Autentique' })
  const raw = await req.text()

  // só aceita aviso assinado com o segredo do webhook (falha fechada)
  const secret = Deno.env.get('AUTENTIQUE_WEBHOOK_SECRET')
  if (!secret) { console.error('AUTENTIQUE_WEBHOOK_SECRET ausente: aviso recusado'); return ok({ error: 'not configured' }, 503) }
  const header = (req.headers.get('x-autentique-signature') ?? '').replace(/^sha256=/, '').trim().toLowerCase()
  if (!header || !safeEqual(await hmacHex(secret, raw), header)) return ok({ error: 'assinatura inválida' }, 401)

  let body: any = {}
  try { body = JSON.parse(raw) } catch { return ok({ error: 'json' }, 400) }
  const ev = body?.event ?? body
  const tipo = String(ev?.type ?? '')
  const obj = ev?.data?.object ?? ev?.data ?? {}
  // id do documento: no evento de documento é o próprio objeto; no de assinatura vem junto da assinatura
  const docId = obj?.object === 'document' ? obj.id : (obj?.document?.id ?? obj?.document_id ?? obj?.document ?? null)
  if (!docId || typeof docId !== 'string') return ok({ ok: true, ignorado: tipo || 'sem documento' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: deal } = await admin.from('deals').select('id').eq('contrato_autentique_id', docId).maybeSingle()
  if (!deal) return ok({ ok: true, ignorado: 'documento não é de um card' })

  try {
    const doc = await buscarDocumento(docId)
    if (!doc) return ok({ ok: true, ignorado: 'documento não encontrado' })
    const r = await aplicarAndamento(admin, deal.id, doc)
    return ok({ ok: true, tipo, status: r.status })
  } catch (e) {
    console.error('autentique-webhook', tipo, (e as Error).message)
    return ok({ error: (e as Error).message }, 500)
  }
})
