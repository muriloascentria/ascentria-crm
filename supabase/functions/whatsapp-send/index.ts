// Envio manual pelo CRM (chamado pelo frontend com o token do usuário logado).
// Body: { contact_id, deal_id?, wa_number_id?, kind: 'text' | 'template' | 'interactive', body?, options?: string[], template_name?, template_lang?, template_params?: string[] }
// wa_number_id: número cadastrado que envia (se omitido: o número do negócio, senão o padrão)
//
// Secrets: WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json, resolveNumber, sendInteractive, sendTemplate, sendText } from '../_shared/wa.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json({ error: 'Não autenticado' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: profile } = await admin.from('profiles').select('active').eq('id', user.id).single()
  if (!profile?.active) return json({ error: 'Usuário inativo' }, 403)

  const b = await req.json().catch(() => ({}))
  // Limites: texto até 4096 caracteres e no máximo 30 envios por minuto por usuário (protege contra abuso/bloqueio da Meta).
  if (typeof b.body === 'string' && b.body.length > 4096) return json({ error: 'Mensagem longa demais' }, 400)
  const { count: recent } = await admin.from('wa_messages').select('id', { count: 'exact', head: true })
    .eq('sent_by', user.id).gte('created_at', new Date(Date.now() - 60_000).toISOString())
  if ((recent ?? 0) >= 30) return json({ error: 'Muitos envios em sequência. Aguarde um minuto.' }, 429)

  // Busca com o token do próprio usuário: só envia para contatos que ele pode ver (regras de acesso do banco).
  const { data: contact } = await userClient.from('contacts').select('id, name, phone, wa_id').eq('id', b.contact_id).maybeSingle()
  if (!contact) return json({ error: 'Contato não encontrado' }, 404)
  if (b.deal_id) {
    const { data: okDeal } = await userClient.from('deals').select('id').eq('id', b.deal_id).eq('contact_id', contact.id).maybeSingle()
    if (!okDeal) return json({ error: 'Negócio não encontrado' }, 404)
  }
  const to = contact.wa_id ?? (contact.phone ?? '').replace(/\D/g, '')
  if (!to) return json({ error: 'Contato sem telefone/WhatsApp' }, 400)

  let waNumberId: string | null = b.wa_number_id ?? null
  if (!waNumberId && b.deal_id) {
    const { data: deal } = await admin.from('deals').select('wa_number_id').eq('id', b.deal_id).single()
    waNumberId = deal?.wa_number_id ?? null
  }
  const phoneNumberId = await resolveNumber(admin, waNumberId)

  let result
  if (b.kind === 'template') {
    if (!b.template_name) return json({ error: 'template_name obrigatório' }, 400)
    result = await sendTemplate(to, b.template_name, b.template_lang ?? 'pt_BR', b.template_params ?? [], phoneNumberId)
  } else if (b.kind === 'interactive') {
    const options = Array.isArray(b.options) ? b.options.filter((o: unknown) => String(o ?? '').trim()) : []
    if (!b.body || options.length === 0) return json({ error: 'Pergunta e opções são obrigatórias' }, 400)
    result = await sendInteractive(to, b.body, options, phoneNumberId)
  } else {
    if (!b.body) return json({ error: 'body obrigatório' }, 400)
    result = await sendText(to, b.body, phoneNumberId)
  }

  await admin.from('wa_messages').insert({
    contact_id: contact.id, deal_id: b.deal_id ?? null, direction: 'out',
    wa_message_id: result.ok ? result.id : null, type: b.kind === 'template' ? 'template' : b.kind === 'interactive' ? 'interactive' : 'text',
    body: b.kind === 'template' ? `[template ${b.template_name}] ${(b.template_params ?? []).join(', ')}`
      : b.kind === 'interactive' ? `${b.body}\n${(b.options ?? []).map((o: string) => `▸ ${o}`).join('\n')}` : b.body,
    template_name: b.template_name ?? null, status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error, sent_by: user.id, wa_number_id: waNumberId,
  })
  if (result.ok && b.deal_id && b.wa_number_id) await admin.from('deals').update({ wa_number_id: b.wa_number_id }).eq('id', b.deal_id)
  if (result.ok && b.deal_id) await admin.from('deals').update({ last_outbound_at: new Date().toISOString() }).eq('id', b.deal_id)
  if (!contact.wa_id && result.ok) await admin.from('contacts').update({ wa_id: to }).eq('id', contact.id)

  return json(result, result.ok ? 200 : 502)
})
