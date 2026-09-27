// Verifica a conexão com a WhatsApp Cloud API e liga este app à conta do WhatsApp (WABA).
//  1. lista os números da conta (confirma que o WA_ACCESS_TOKEN funciona e tem acesso à conta)
//  2. inscreve o app nos webhooks da conta (POST /{waba}/subscribed_apps) — não remove outros apps inscritos
//  3. devolve a lista de apps inscritos (o Go High Level, se houver, continua na lista)
// Autorização: token de um usuário administrador ativo.  Body: { waba_id: string, subscribe?: boolean }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { GRAPH_VERSION, cors, json } from '../_shared/wa.ts'

async function graph(path: string, token: string, method = 'GET') {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, { method, headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, body, error: body?.error?.message as string | undefined }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autorizado' }, 401)
  const { data: p } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
  if (!p?.active || p.role !== 'admin') return json({ error: 'Apenas administradores' }, 403)

  const token = Deno.env.get('WA_ACCESS_TOKEN')
  const missing = ['WA_ACCESS_TOKEN', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN', 'CRON_SECRET'].filter((k) => !Deno.env.get(k))
  if (!token) return json({ ok: false, missing, error: 'O secret WA_ACCESS_TOKEN não está configurado no Supabase.' })

  const { waba_id, subscribe = true } = await req.json().catch(() => ({}))
  if (!waba_id || !/^\d+$/.test(String(waba_id))) return json({ ok: false, missing, error: 'Informe o ID da conta do WhatsApp (WABA ID), só números.' })

  const numbers = await graph(`${waba_id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`, token)
  if (!numbers.ok) return json({ ok: false, missing, step: 'phone_numbers', error: numbers.error })

  let subscribed: { ok: boolean; error?: string } = { ok: true }
  if (subscribe) {
    const r = await graph(`${waba_id}/subscribed_apps`, token, 'POST')
    subscribed = { ok: r.ok, error: r.error }
  }
  const apps = await graph(`${waba_id}/subscribed_apps`, token)

  return json({
    ok: subscribed.ok,
    missing,
    numbers: numbers.body?.data ?? [],
    subscribe_error: subscribed.error ?? null,
    apps: (apps.body?.data ?? []).map((a: any) => a?.whatsapp_business_api_data?.name ?? a?.name ?? a?.id),
  })
})
