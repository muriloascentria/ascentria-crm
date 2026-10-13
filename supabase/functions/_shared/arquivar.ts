// Contrato assinado → PDF na pasta "Contratos_Assinados › Mentoria_Essência" do Drive da empresa
// (org_settings.contract_signed_folder_id). Quem grava é a conta do Murilo (contract_signer_email), que pode
// editar a pasta; o PDF vem da Autentique (assinado) ou, sem ela, do Google Docs do contrato.
// Roda uma vez por card (deals.contrato_arquivo_id). Falhas não atrapalham o resto: só ficam no log.
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (delegação com o escopo drive)

type SA = { client_email: string; private_key: string; token_uri?: string }
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function token(sa: SA, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, sub: subject, scope: DRIVE_SCOPE, aud, iat: now, exp: now + 3600 }))}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const res = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }) })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Google: ' + (data.error_description || data.error || res.status))
  return data.access_token
}

const dataBR = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '')

export async function arquivarContrato(admin: any, dealId: string, pdfUrl?: string | null): Promise<{ ok: boolean; id?: string; url?: string; error?: string }> {
  try {
    const { data: d } = await admin.from('deals').select('id, title, contrato, contrato_doc_id, contrato_pdf_url, contrato_arquivo_id, contrato_assinado_em, contact:contacts(name)').eq('id', dealId).single()
    if (!d) return { ok: false, error: 'card não encontrado' }
    if (d.contrato_arquivo_id) return { ok: true, id: d.contrato_arquivo_id }
    const { data: st } = await admin.from('org_settings').select('contract_signed_folder_id, contract_signer_email').eq('id', 1).single()
    const pasta = st?.contract_signed_folder_id
    if (!pasta) return { ok: false, error: 'pasta dos contratos assinados não configurada' }
    const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    const sa: SA | null = raw ? JSON.parse(raw) : null
    if (!sa?.client_email) return { ok: false, error: 'conta do Google não conectada' }

    // 1) o PDF: assinado da Autentique (com as assinaturas) ou o Google Docs do contrato exportado
    let pdf: Uint8Array | null = null
    const link = pdfUrl || d.contrato_pdf_url
    if (link) {
      const tkA = Deno.env.get('AUTENTIQUE_TOKEN')
      let r = await fetch(link, tkA ? { headers: { Authorization: `Bearer ${tkA}` } } : {})
      if (!r.ok && tkA) r = await fetch(link)
      if (r.ok && /pdf|octet/i.test(r.headers.get('content-type') || 'application/pdf')) pdf = new Uint8Array(await r.arrayBuffer())
    }
    if (!pdf && d.contrato_doc_id) {
      const dono = String(d.contrato?.dono || st?.contract_signer_email || 'murilo@ascentria.com.br')
      const tkDono = await token(sa, dono)
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${d.contrato_doc_id}/export?mimeType=application/pdf`, { headers: { Authorization: `Bearer ${tkDono}` } })
      if (r.ok) pdf = new Uint8Array(await r.arrayBuffer())
    }
    if (!pdf) return { ok: false, error: 'não consegui obter o PDF do contrato' }

    // 2) envia para a pasta, em nome do Murilo
    const nome = String(d.contrato?.nome || d.contact?.name || d.title || 'Lead').replace(/[\\/:*?"<>|]+/g, ' ').trim()
    const titulo = `Contrato Mentoria Essência - ${nome} - assinado ${dataBR(d.contrato_assinado_em || new Date().toISOString())}.pdf`
    const tk = await token(sa, String(st?.contract_signer_email || 'murilo@ascentria.com.br'))
    const limite = 'ecrm' + crypto.randomUUID().replace(/-/g, '')
    const meta = JSON.stringify({ name: titulo, parents: [pasta], mimeType: 'application/pdf' })
    const enc = new TextEncoder()
    const corpo = new Uint8Array([
      ...enc.encode(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: application/pdf\r\n\r\n`),
      ...pdf,
      ...enc.encode(`\r\n--${limite}--`),
    ])
    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': `multipart/related; boundary=${limite}` }, body: corpo,
    })
    const f: any = await up.json().catch(() => ({}))
    if (!up.ok) return { ok: false, error: 'Drive: ' + (f?.error?.message || up.status) }
    await admin.from('deals').update({ contrato_arquivo_id: f.id, contrato_arquivo_url: f.webViewLink ?? null }).eq('id', dealId)
    await admin.from('activities').insert({ type: 'note', title: 'Contrato assinado salvo na pasta Contratos_Assinados › Mentoria_Essência', description: `${titulo}\n${f.webViewLink ?? ''}`, deal_id: dealId, done: true, done_at: new Date().toISOString() })
    return { ok: true, id: f.id, url: f.webViewLink }
  } catch (e) {
    console.error('arquivarContrato', (e as Error).message)
    return { ok: false, error: (e as Error).message }
  }
}
