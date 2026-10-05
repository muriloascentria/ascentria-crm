// Leitura do estado da conta do WhatsApp na Meta (só consultas GET; não envia nada, não muda nada).
// Devolve: estado da conta (WABA), revisão, e estado de cada número ativo do CRM.
import { createClient } from 'npm:@supabase/supabase-js@2'

const V = Deno.env.get('WA_GRAPH_VERSION') ?? 'v21.0'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { ...cors, 'Content-Type': 'application/json' } })

async function graph(path: string, token: string) {
  const r = await fetch(`https://graph.facebook.com/${V}/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const b: any = await r.json().catch(() => ({}))
  return r.ok ? b : { error: b?.error?.message ?? `HTTP ${r.status}`, code: b?.error?.code ?? null, subcode: b?.error?.error_subcode ?? null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const token = Deno.env.get('WA_ACCESS_TOKEN')
  if (!token) return json({ error: 'sem WA_ACCESS_TOKEN' })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: s } = await admin.from('org_settings').select('wa_waba_id').eq('id', 1).single()
  const { data: nums } = await admin.from('wa_numbers').select('phone_number_id').eq('active', true)
  const waba = s?.wa_waba_id
    ? await graph(`${s.wa_waba_id}?fields=name,account_review_status,ban_state,health_status,owner_business_info`, token)
    : { error: 'sem wa_waba_id' }
  const phones = await Promise.all((nums ?? []).map((n: any) =>
    graph(`${n.phone_number_id}?fields=display_phone_number,verified_name,status,quality_rating,name_status,messaging_limit_tier,health_status`, token)))
  const out = { em: new Date().toISOString(), waba, phones }
  console.log('wa-status', JSON.stringify(out))
  return json(out)
})
