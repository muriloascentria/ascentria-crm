// Completa o link da GRAVAÇÃO das sessões que foram registradas antes de o Google terminar de processar o vídeo.
// Varre os cards com sessão no Essência Plat, sem gravação e com as Anotações do Gemini no lugar da transcrição;
// lê as anotações (que trazem o link "Gravação") e grava o link no card e na mesma linha do Registro de Sessões 1:1.
// Roda pelo cron a cada 30 minutos. Autorização: Authorization: Bearer <cron_secret>.
// Secrets: GOOGLE_SERVICE_ACCOUNT_JSON (delegação com drive.readonly), PLAT_SERVICE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2'

const DRIVE_RO_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const DIAS = 45 // só sessões recentes
type SA = { client_email: string; private_key: string; token_uri?: string }

const PLAT_URL = Deno.env.get('PLAT_URL') ?? 'https://yahjhvnubmmfvxbjxmoo.supabase.co'
function platClient() {
  const key = Deno.env.get('PLAT_SERVICE_KEY')
  return key ? createClient(PLAT_URL, key, { auth: { persistSession: false } }) : null
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const tokens = new Map<string, string>()
async function googleToken(sa: SA, subject: string, scope: string): Promise<string> {
  const k = subject + ' ' + scope
  if (tokens.has(k)) return tokens.get(k)!
  const now = Math.floor(Date.now() / 1000)
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, sub: subject, scope, aud, iat: now, exp: now + 3600 }))}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const res = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }) })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Google: ' + String(data.error_description || data.error || res.status))
  tokens.set(k, data.access_token)
  return data.access_token
}

/** Abre as Anotações do Gemini (como HTML, para manter os links) e devolve o link da gravação, se já existir. */
async function gravacaoDasAnotacoes(sa: SA, emails: string[], docId: string): Promise<string | null> {
  for (const email of emails) {
    for (const scope of [DRIVE_RO_SCOPE, DRIVE_SCOPE]) {
      try {
        const tk = await googleToken(sa, email, scope)
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/html&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tk}` } })
        if (!r.ok) continue
        const bruto = (await r.text()).replace(/&amp;/g, '&')
        let html = bruto
        try { html = decodeURIComponent(bruto) } catch { /* links já legíveis */ }
        // o link "Gravação" das anotações aponta para o vídeo no Drive (drive.google.com/file/d/<id>)
        const m = html.match(/drive\.google\.com\/file\/d\/([\w-]{20,})/)
        return m ? `https://drive.google.com/file/d/${m[1]}/view` : null
      } catch { /* tenta a próxima conta/escopo */ }
    }
  }
  return null
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: ok } = await admin.rpc('check_cron_secret', { p: t })
  if (!ok) return json({ error: 'não autorizado' }, 401)
  let sa: SA | null = null
  try { sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || 'null') } catch { sa = null }
  if (!sa) return json({ ok: false, error: 'Falta GOOGLE_SERVICE_ACCOUNT_JSON' })
  const plat = platClient()

  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString().slice(0, 10)
  const { data: rows } = await admin.from('deals').select('id, title, plat_sessao_id, sessao_registro, seller:calendar_sellers(email)')
    .not('plat_sessao_id', 'is', null).limit(1000)
  const pendentes = (rows ?? []).filter((d: any) => {
    const s = d.sessao_registro ?? {}
    return !String(s.video || '').trim() && /docs\.google\.com\/document\/d\//.test(String(s.transcricao || '')) && String(s.data || '') >= desde
  })
  if (!pendentes.length) return json({ ok: true, pendentes: 0 })

  const { data: sellers } = await admin.from('calendar_sellers').select('email').eq('active', true)
  const { data: cfg } = await admin.from('org_settings').select('contract_signer_email').eq('id', 1).maybeSingle()
  const todos = [...new Set([...(sellers ?? []).map((s: any) => s.email), cfg?.contract_signer_email].filter(Boolean))] as string[]

  const out: any[] = []
  for (const d of pendentes.slice(0, 40)) {
    const docId = String(d.sessao_registro.transcricao).match(/\/document\/d\/([\w-]+)/)?.[1]
    if (!docId) continue
    const emails = [...new Set([(d as any).seller?.email, ...todos].filter(Boolean))] as string[]
    const video = await gravacaoDasAnotacoes(sa, emails, docId).catch(() => null)
    if (!video) { out.push({ id: d.id, ok: false }); continue }
    await admin.from('deals').update({ sessao_registro: { ...d.sessao_registro, video } }).eq('id', d.id)
    if (plat) {
      const { data: linha } = await plat.from('venda_sessoes').select('id, video_venda').eq('id', d.plat_sessao_id).maybeSingle()
      if (linha && !String(linha.video_venda || '').trim()) await plat.from('venda_sessoes').update({ video_venda: video }).eq('id', d.plat_sessao_id)
    }
    out.push({ id: d.id, ok: true })
  }
  return json({ ok: true, pendentes: pendentes.length, feitos: out })
})
