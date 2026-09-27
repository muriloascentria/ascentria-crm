// Verifica a conexão com a WhatsApp Cloud API e liga este app à conta do WhatsApp (WABA).
//  1. lista os números da conta (confirma que o WA_ACCESS_TOKEN funciona e tem acesso à conta)
//  2. inscreve o app nos webhooks da conta (POST /{waba}/subscribed_apps) — não remove outros apps inscritos
//  3. devolve a lista de apps inscritos (o Go High Level, se houver, continua na lista)
// Autorização: token de um usuário administrador ativo.  Body: { waba_id: string, subscribe?: boolean }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { GRAPH_VERSION, cors, json } from '../_shared/wa.ts'

async function graph(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data: any = await res.json().catch(() => ({}))
  return { ok: res.ok, body: data, error: data?.error?.message as string | undefined }
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
  if (!token) { console.log('wa-connect', JSON.stringify({ missing })); return json({ ok: false, missing, error: 'O secret WA_ACCESS_TOKEN não está configurado no Supabase.' }) }

  const { waba_id, subscribe = true, action, phone_number_id, pin, code, method: body_method } = await req.json().catch(() => ({}))

  // Reverificação do número (quando a Meta responde #133006): pede o código por SMS/ligação e confirma.
  if (action === 'request_code' || action === 'verify_code') {
    if (!/^\d+$/.test(String(phone_number_id ?? ''))) return json({ ok: false, error: 'Número inválido.' })
    const payload = action === 'request_code'
      ? { code_method: body_method === 'VOICE' ? 'VOICE' : 'SMS', language: 'pt_BR' }
      : { code: String(code ?? '').replace(/\D/g, '') }
    if (action === 'verify_code' && !payload.code) return json({ ok: false, error: 'Informe o código recebido.' })
    const r = await graph(`${phone_number_id}/${action}`, token, 'POST', payload)
    console.log('wa-connect ' + action, JSON.stringify({ phone_number_id, ok: r.ok, error: r.error ?? null }))
    return json({ ok: r.ok, error: r.error ?? null })
  }

  // Registrar (ou re-registrar) um número na Cloud API com o PIN da verificação em duas etapas.
  if (action === 'register') {
    if (!/^\d+$/.test(String(phone_number_id ?? '')) || !/^\d{6}$/.test(String(pin ?? ''))) {
      return json({ ok: false, error: 'Informe o número e um PIN de 6 dígitos.' })
    }
    const r = await graph(`${phone_number_id}/register`, token, 'POST', { messaging_product: 'whatsapp', pin: String(pin) })
    const st = await graph(`${phone_number_id}?fields=display_phone_number,status,platform_type`, token)
    console.log('wa-connect register', JSON.stringify({ phone_number_id, ok: r.ok, error: r.error ?? null, status: st.body?.status ?? null }))
    return json({ ok: r.ok, error: r.error ?? null, phone: st.ok ? st.body : null })
  }
  if (!waba_id || !/^\d+$/.test(String(waba_id))) return json({ ok: false, missing, error: 'Informe o ID da conta do WhatsApp (WABA ID), só números.' })

  const numbers = await graph(`${waba_id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`, token)
  if (!numbers.ok) { console.log('wa-connect', JSON.stringify({ step: 'phone_numbers', missing, error: numbers.error })); return json({ ok: false, missing, step: 'phone_numbers', error: numbers.error }) }

  let subscribed: { ok: boolean; error?: string } = { ok: true }
  if (subscribe) {
    const r = await graph(`${waba_id}/subscribed_apps`, token, 'POST')
    subscribed = { ok: r.ok, error: r.error }
  }
  const apps = await graph(`${waba_id}/subscribed_apps`, token)

  // Diagnóstico: permissões realmente concedidas ao token e dono da conta do WhatsApp
  const perms = await graph('me/permissions', token)
  const me = await graph('me?fields=id,name', token)
  const wabaInfo = await graph(`${waba_id}?fields=id,name,owner_business_info,on_behalf_of_business_info,account_review_status`, token)
  const ownerId = wabaInfo.body?.owner_business_info?.id
  const assigned = ownerId ? await graph(`${waba_id}/assigned_users?business=${ownerId}`, token) : null
  const { data: nums } = await admin.from('wa_numbers').select('phone_number_id').eq('active', true)
  const phoneDetails = await Promise.all((nums ?? []).map(async (n: { phone_number_id: string }) => {
    const r = await graph(`${n.phone_number_id}?fields=display_phone_number,status,platform_type,account_mode,name_status,messaging_limit_tier`, token)
    return r.ok ? r.body : { id: n.phone_number_id, error: r.error }
  }))

  const result = {
    ok: subscribed.ok,
    missing,
    numbers: numbers.body?.data ?? [],
    subscribe_error: subscribed.error ?? null,
    apps: (apps.body?.data ?? []).map((a: any) => a?.whatsapp_business_api_data?.name ?? a?.name ?? a?.id),
    apps_error: apps.error ?? null,
    token_user: me.body?.name ?? me.error ?? null,
    permissions: (perms.body?.data ?? []).filter((x: any) => x.status === 'granted').map((x: any) => x.permission),
    permissions_error: perms.error ?? null,
    assigned_users: assigned ? (assigned.ok ? (assigned.body?.data ?? []).map((u: any) => `${u.name}: ${(u.tasks ?? []).join('/')}`) : [assigned.error]) : null,
    phones: phoneDetails,
    waba: wabaInfo.ok ? { name: wabaInfo.body?.name, owner: wabaInfo.body?.owner_business_info?.name, owner_id: wabaInfo.body?.owner_business_info?.id, on_behalf_of: wabaInfo.body?.on_behalf_of_business_info?.name ?? null, review: wabaInfo.body?.account_review_status } : { error: wabaInfo.error },
  }
  console.log('wa-connect', JSON.stringify(result)) // diagnóstico (sem segredos)
  return json(result)
})
