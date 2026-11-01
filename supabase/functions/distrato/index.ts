// Termo de cancelamento (distrato) da Mentoria Essência, a partir do card.
//   enviar { deal_id } → PDF do documento (deals.distrato_doc_id) → Autentique (Murilo + lead, por e-mail)
//   status { deal_id } → confere na Autentique quem já assinou
// Secrets: GOOGLE_SERVICE_ACCOUNT_JSON, AUTENTIQUE_TOKEN
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/wa.ts'

const SCOPES = 'https://www.googleapis.com/auth/drive'
const AUT = 'https://api.autentique.com.br/v2/graphql'
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
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, sub: subject, scope: SCOPES, aud, iat: now, exp: now + 3600 }))}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const res = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }) })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Google: ' + (data.error_description || data.error || res.status))
  return data.access_token
}
async function aut(body: BodyInit, isForm = false) {
  const res = await fetch(AUT, { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('AUTENTIQUE_TOKEN')}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) }, body })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || data.errors?.length) throw new Error('Autentique: ' + (data.errors?.[0]?.message || data.message || res.status))
  return data.data
}
function resumo(doc: any) {
  const sigs = (doc?.signatures ?? []).filter((s: any) => s.action?.name === 'SIGN')
  const assinaturas = sigs.map((s: any) => ({ nome: s.name || null, email: s.email || null, assinado_em: s.signed?.created_at ?? null, recusado_em: s.rejected?.created_at ?? null, visto_em: s.viewed?.created_at ?? null }))
  const recusado = assinaturas.some((a: any) => a.recusado_em)
  const todos = assinaturas.length > 0 && assinaturas.every((a: any) => a.assinado_em)
  return { assinaturas, status: recusado ? 'recusado' : todos ? 'assinado' : 'enviado', pdf: doc?.files?.signed ?? null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { data: me } = await admin.from('profiles').select('active').eq('id', user.id).single()
  if (!me?.active) return json({ error: 'Usuário inativo' }, 403)
  const b = await req.json().catch(() => ({}))
  const { data: d } = await userClient.from('deals')
    .select('id, title, distrato_doc_id, distrato_status, distrato_autentique_id, contact:contacts(name, email)')
    .eq('id', String(b.deal_id ?? '')).maybeSingle() as any
  if (!d) return json({ ok: false, error: 'Negócio não encontrado.' })
  if (!Deno.env.get('AUTENTIQUE_TOKEN')) return json({ ok: false, error: 'Autentique não configurada.' })

  try {
    if (b.action === 'status') {
      if (!d.distrato_autentique_id) return json({ ok: false, error: 'O termo ainda não foi enviado.' })
      const r0 = await aut(JSON.stringify({ query: `query { document(id: ${JSON.stringify(d.distrato_autentique_id)}) { id files { signed } signatures { name email action { name } signed { created_at } rejected { created_at } viewed { created_at } } } }` }))
      const r = resumo(r0.document)
      const patch: Record<string, unknown> = { distrato_status: r.status, distrato_assinaturas: r.assinaturas }
      if (r.status === 'assinado') { patch.distrato_pdf_url = r.pdf; patch.distrato_assinado_em = r.assinaturas.map((a: any) => a.assinado_em).sort().pop() }
      await admin.from('deals').update(patch).eq('id', d.id)
      return json({ ok: true, ...r })
    }
    if (b.action !== 'enviar' && b.action !== 'previa') return json({ ok: false, error: 'Ação desconhecida' }, 400)
    if (!d.distrato_doc_id) return json({ ok: false, error: 'Este card não tem termo de cancelamento.' })
    if (b.action === 'previa') {
      // texto atual do documento, para revisar no CRM antes de enviar
      const { data: st0 } = await admin.from('org_settings').select('contract_signer_email').eq('id', 1).single()
      const sa0: SA = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
      const tk0 = await googleToken(sa0, String(st0?.contract_signer_email || 'murilo@ascentria.com.br'))
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${d.distrato_doc_id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${tk0}` } })
      if (!r.ok) throw new Error('Não consegui ler o termo (Google ' + r.status + ').')
      const texto = (await r.text()).replace(/^\uFEFF/, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
      return json({ ok: true, texto, email: d.contact?.email || null, nome: d.contact?.name || d.title, signatario: String(st0?.contract_signer_email || 'murilo@ascentria.com.br') })
    }
    const email = String(b.email || d.contact?.email || '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'O contato não tem e-mail válido para a assinatura.' })
    const { data: st } = await admin.from('org_settings').select('contract_signer_email').eq('id', 1).single()
    const signatario = String(st?.contract_signer_email || 'murilo@ascentria.com.br')
    const sa: SA = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')!)
    const tk = await googleToken(sa, signatario)
    const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${d.distrato_doc_id}?fields=name&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tk}` } }).then((r) => r.json())
    const pdfRes = await fetch(`https://www.googleapis.com/drive/v3/files/${d.distrato_doc_id}/export?mimeType=application/pdf`, { headers: { Authorization: `Bearer ${tk}` } })
    if (!pdfRes.ok) throw new Error('Não consegui gerar o PDF do termo (Google ' + pdfRes.status + ').')
    const pdf = new Uint8Array(await pdfRes.arrayBuffer())
    // termo anterior ainda não assinado: cancela na Autentique (a Joana não assina a versão velha)
    if (d.distrato_autentique_id && d.distrato_status !== 'assinado') {
      await aut(JSON.stringify({ query: `mutation { deleteDocument(id: ${JSON.stringify(d.distrato_autentique_id)}) }` })).catch(() => null)
    }
    const nome = String(meta?.name || `Termo de Cancelamento - ${d.contact?.name || d.title}`)
    const operations = {
      query: `mutation C($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) { createDocument(document: $document, signers: $signers, file: $file) { id signatures { name email action { name } signed { created_at } rejected { created_at } viewed { created_at } } } }`,
      variables: {
        document: { name: nome, message: 'Olá! Segue o Termo de Cancelamento da Mentoria Essência para assinatura eletrônica. Qualquer dúvida, é só responder pelo WhatsApp. — Ascentria', reminder: 'WEEKLY', refusable: true },
        signers: [{ email: signatario, action: 'SIGN', name: 'Murilo Pedroso Alves' }, { email, action: 'SIGN', name: d.contact?.name || d.title }],
        file: null,
      },
    }
    const form = new FormData()
    form.append('operations', JSON.stringify(operations))
    form.append('map', JSON.stringify({ file: ['variables.file'] }))
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), `${nome}.pdf`)
    const criado = (await aut(form, true)).createDocument
    const r = resumo(criado)
    const agora = new Date().toISOString()
    await admin.from('deals').update({ distrato_autentique_id: criado.id, distrato_status: 'enviado', distrato_enviado_em: agora, distrato_assinaturas: r.assinaturas }).eq('id', d.id)
    await admin.from('activities').insert({ type: 'note', title: 'Termo de cancelamento enviado para assinatura (Autentique)', description: `Assinam: ${signatario} e ${email}`, deal_id: d.id, done: true, done_at: agora, created_by: user.id })
    return json({ ok: true, enviado: true, email })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message })
  }
})
