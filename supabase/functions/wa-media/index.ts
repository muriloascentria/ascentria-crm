// Mídia recebida no WhatsApp (áudio, foto, vídeo, documento, figurinha).
// POST { message_id }  (usuário logado)
//  → confere se quem pede pode ver a conversa (regras de acesso do banco)
//  → na 1ª vez baixa o arquivo da Meta e guarda na pasta privada "wa-media"
//  → devolve um link temporário (1 hora) para tocar/abrir no CRM
// Secret: WA_ACCESS_TOKEN
import { createClient } from 'npm:@supabase/supabase-js@2'
import { GRAPH_VERSION, cors, json } from '../_shared/wa.ts'

const MEDIA_TYPES = ['audio', 'image', 'video', 'document', 'sticker']
const EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { data: me } = await admin.from('profiles').select('active').eq('id', user.id).single()
  if (!me?.active) return json({ error: 'Usuário inativo' }, 403)

  const { message_id } = await req.json().catch(() => ({}))
  if (!message_id || typeof message_id !== 'string') return json({ ok: false, error: 'Mensagem não informada' }, 400)

  // a mensagem precisa ser visível para quem pede
  const { data: msg } = await userClient.from('wa_messages').select('id, type, raw, media_path, media_mime').eq('id', message_id).maybeSingle()
  if (!msg) return json({ ok: false, error: 'Mensagem não encontrada' }, 404)
  if (!MEDIA_TYPES.includes(msg.type)) return json({ ok: false, error: 'Essa mensagem não tem arquivo' }, 400)

  try {
    let path = msg.media_path as string | null
    let mime = msg.media_mime as string | null
    if (!path) {
      const info = (msg.raw ?? {})[msg.type] ?? {}
      const mediaId = info.id
      if (!mediaId) return json({ ok: false, error: 'A Meta não mandou o arquivo dessa mensagem' })
      const token = Deno.env.get('WA_ACCESS_TOKEN')
      if (!token) return json({ ok: false, error: 'WhatsApp não configurado' })

      const meta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` } })
      const metaJson: any = await meta.json().catch(() => ({}))
      if (!meta.ok || !metaJson.url) {
        return json({ ok: false, error: meta.status === 404 || metaJson?.error?.code === 100 ? 'O arquivo não está mais disponível na Meta (expira depois de alguns dias).' : 'Não consegui buscar o arquivo na Meta.' })
      }
      const file = await fetch(metaJson.url, { headers: { Authorization: `Bearer ${token}` } })
      if (!file.ok) return json({ ok: false, error: 'Não consegui baixar o arquivo da Meta.' })
      const bytes = new Uint8Array(await file.arrayBuffer())
      mime = String(metaJson.mime_type || info.mime_type || file.headers.get('content-type') || 'application/octet-stream')
      const base = mime.split(';')[0].trim()
      const ext = EXT[base] || (info.filename?.split('.').pop()) || 'bin'
      path = `${msg.id}.${ext}`
      const up = await admin.storage.from('wa-media').upload(path, bytes, { contentType: base, upsert: true })
      if (up.error) throw new Error(up.error.message)
      await admin.from('wa_messages').update({ media_path: path, media_mime: mime }).eq('id', msg.id)
    }
    const { data: signed, error: sErr } = await admin.storage.from('wa-media').createSignedUrl(path, 3600)
    if (sErr || !signed?.signedUrl) throw new Error(sErr?.message || 'link')
    return json({ ok: true, url: signed.signedUrl, mime, type: msg.type })
  } catch (e) {
    console.error('wa-media', (e as Error).message)
    return json({ ok: false, error: 'Não consegui abrir o arquivo agora. Tente de novo.' })
  }
})
