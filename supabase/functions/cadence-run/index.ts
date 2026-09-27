// Motor da cadência: roda 1x por hora (pg_cron) ou quando você clica em "Rodar agora" nas configurações.
//  1. chama run_cadence() no banco (avança dias, arquiva, reativa)
//  2. envia as mensagens pendentes em wa_outbox pela API da Meta
//
// Autorização: header "Authorization: Bearer <segredo cron_secret do Vault>"  (pg_cron)
//              ou token de um usuário administrador (botão no CRM)
// Secrets: WA_ACCESS_TOKEN (o segredo do cron fica no Vault do banco, não em variável de ambiente)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json, resolveNumber, sendTemplate, sendText } from '../_shared/wa.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let authorized = false
  if (token.length >= 32 && !token.startsWith('eyJ')) {
    const { data: ok } = await admin.rpc('check_cron_secret', { p: token })
    authorized = ok === true
  }
  if (!authorized && token.startsWith('eyJ')) {
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (user) {
      const { data: p } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
      authorized = !!p?.active && p.role === 'admin'
    }
  }
  if (!authorized) return json({ error: 'Não autorizado' }, 401)

  // 1) motor no banco
  const { data: cadence, error: cadErr } = await admin.rpc('run_cadence')
  if (cadErr) return json({ error: cadErr.message }, 500)

  // 2) fila de envio
  const { data: queue } = await admin.from('wa_outbox').select('*, contact:contacts(id, wa_id, phone)')
    .eq('status', 'pending').lt('attempts', 3).order('created_at').limit(50)

  let sent = 0, failed = 0
  const canSend = !!Deno.env.get('WA_ACCESS_TOKEN')
  for (const item of queue ?? []) {
    if (!canSend) break
    const to = item.contact?.wa_id ?? (item.contact?.phone ?? '').replace(/\D/g, '')
    const phoneNumberId = await resolveNumber(admin, item.wa_number_id)
    const result = !to ? { ok: false as const, error: 'Contato sem WhatsApp' }
      : !phoneNumberId && !Deno.env.get('WA_PHONE_NUMBER_ID') ? { ok: false as const, error: 'Nenhum número de WhatsApp cadastrado (Configurações → WhatsApp)' }
      : item.kind === 'template'
        ? await sendTemplate(to, item.template_name, item.template_lang ?? 'pt_BR', item.template_params ?? [], phoneNumberId)
        : await sendText(to, item.body ?? '', phoneNumberId)

    await admin.from('wa_outbox').update({
      status: result.ok ? 'sent' : (item.attempts + 1 >= 3 ? 'failed' : 'pending'),
      attempts: item.attempts + 1, error: result.ok ? null : result.error, sent_at: result.ok ? new Date().toISOString() : null,
    }).eq('id', item.id)

    await admin.from('wa_messages').insert({
      contact_id: item.contact_id, deal_id: item.deal_id, direction: 'out',
      wa_message_id: result.ok ? result.id : null, type: item.kind,
      body: item.kind === 'template' ? `[template ${item.template_name}] ${(item.template_params ?? []).join(', ')}` : item.body,
      template_name: item.template_name, status: result.ok ? 'sent' : 'failed', error: result.ok ? null : result.error, wa_number_id: item.wa_number_id,
    })
    if (result.ok && item.deal_id) await admin.from('deals').update({ last_outbound_at: new Date().toISOString() }).eq('id', item.deal_id)
    result.ok ? sent++ : failed++
  }

  return json({ ok: true, cadence, outbox: { sent, failed, pending_without_credentials: !canSend ? (queue?.length ?? 0) : 0 } })
})
