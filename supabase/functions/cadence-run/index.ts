// Motor da cadência: roda a cada 5 minutos (pg_cron) ou quando você clica em "Rodar agora" nas configurações.
//  0. confere na Meta se os modelos dos lembretes já foram aprovados
//  1. chama run_cadence() no banco (avança dias, arquiva, reativa, enfileira lembretes do encontro)
//  2. envia as mensagens pendentes em wa_outbox pela API da Meta
//
// Autorização: header "Authorization: Bearer <segredo cron_secret do Vault>"  (pg_cron)
//              ou token de um usuário administrador (botão no CRM)
// Secrets: WA_ACCESS_TOKEN (o segredo do cron fica no Vault do banco, não em variável de ambiente)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { GRAPH_VERSION, cors, json, resolveNumber, sendTemplate, sendText } from '../_shared/wa.ts'

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

  // 0) modelos dos lembretes ainda não aprovados: confere o status na Meta (liga sozinho quando aprovar)
  await syncReminderTemplates(admin)

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

async function syncReminderTemplates(admin: any) {
  try {
    const token = Deno.env.get('WA_ACCESS_TOKEN')
    const { data: st } = await admin.from('org_settings').select('wa_waba_id, reminder_templates, wa_templates_checked_at').eq('id', 1).single()
    const rt: Record<string, any> = st?.reminder_templates || {}
    const pend = Object.entries(rt).filter(([, v]) => v?.name && v.approved !== true)
    if (!token || !st?.wa_waba_id) return
    // no máximo 1 consulta a cada 30 min quando não há modelo de lembrete esperando aprovação
    const last = Date.parse(st.wa_templates_checked_at || '') || 0
    if (!pend.length && Date.now() - last < 30 * 60_000) return
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${st.wa_waba_id}/message_templates?fields=name,status,language,category,rejected_reason&limit=200`, { headers: { Authorization: `Bearer ${token}` } })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) return
    let changed = false
    for (const [k, v] of pend) {
      const t = (data.data ?? []).find((x: any) => x.name === v.name && (!v.lang || x.language === v.lang))
      // guarda o status da Meta (em análise, rejeitado, motivo) para aparecer no CRM
      const status = t?.status ?? 'NAO_ENCONTRADO'
      const info = { status, category: t?.category ?? null, rejected_reason: t?.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null }
      if (status === 'APPROVED') { rt[k] = { ...v, ...info, approved: true }; changed = true }
      else if (v.status !== info.status || v.category !== info.category || v.rejected_reason !== info.rejected_reason) { rt[k] = { ...v, ...info }; changed = true }
    }
    // retrato de todos os modelos da conta (nome, status, categoria) para conferir sem abrir a Meta
    const snapshot = (data.data ?? []).map((x: any) => ({ name: x.name, language: x.language, status: x.status, category: x.category, rejected_reason: x.rejected_reason && x.rejected_reason !== 'NONE' ? x.rejected_reason : null }))
    await admin.from('org_settings').update({ ...(changed ? { reminder_templates: rt } : {}), wa_templates: snapshot, wa_templates_checked_at: new Date().toISOString() }).eq('id', 1)
  } catch (e) { console.error('syncReminderTemplates', (e as Error).message) }
}
