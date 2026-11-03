// Rota de Embarque do Essência Plat: quando o negócio do pipeline Mentoria entra em "Fechou mentoria",
// o lead cai sozinho na coluna "Grupo criado" do Plat (aguardando conta, até a pessoa entrar na plataforma).
// "Comprou e cancelou" tira o card do funil; voltar para outra etapa remove o card que ainda não virou aluno.
// Chamada pelo gatilho da tabela deals (pg_net) com { deal_id } e pelo cron (sem deal_id = varredura).
// Autorização: Authorization: Bearer <cron_secret>. Secret: PLAT_SERVICE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2'

const PLAT_URL = Deno.env.get('PLAT_URL') ?? 'https://yahjhvnubmmfvxbjxmoo.supabase.co'
function platClient() {
  const key = Deno.env.get('PLAT_SERVICE_KEY')
  return key ? createClient(PLAT_URL, key, { auth: { persistSession: false } }) : null
}

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const FECHOU = 'Fechou mentoria'
const CANCELOU = 'Comprou e cancelou'
const INICIO = '2026-11-03' // a varredura só olha vendas a partir do dia em que a integração entrou no ar

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: ok } = await admin.rpc('check_cron_secret', { p: t })
  if (!ok) return json({ error: 'não autorizado' }, 401)
  const plat = platClient()
  if (!plat) return json({ ok: false, error: 'Falta PLAT_SERVICE_KEY' })
  const b = await req.json().catch(() => ({}))

  const sel = 'id, title, stage_entered_at, closed_at, plat_sessao_id, contrato, stage:stages(name, pipeline:pipelines(name)), seller:calendar_sellers(name), contact:contacts(name, phone, wa_id, email)'
  let deals: any[] = []
  if (b?.deal_id) {
    const { data } = await admin.from('deals').select(sel).eq('id', String(b.deal_id)).maybeSingle()
    if (data) deals = [data]
  } else {
    const { data } = await admin.from('deals').select(sel).gte('stage_entered_at', INICIO).limit(500)
    deals = (data ?? []).filter((d: any) => [FECHOU, CANCELOU].includes(d.stage?.name))
  }

  const out: any[] = []
  for (const d of deals) {
    try {
      if (d.stage?.pipeline?.name && d.stage.pipeline.name !== 'Mentoria') continue
      if (/\bteste\b/i.test(d.title ?? '')) continue
      const etapa = d.stage?.name
      const status = etapa === FECHOU ? 'ativo' : etapa === CANCELOU ? 'cancelado' : 'removido'
      if (status === 'removido') {
        // Saiu de "Fechou mentoria" para outra etapa: só existe algo a fazer se o lead já tinha ido para o Plat.
        const { data: ja } = await plat.from('embarque_leads').select('id').eq('crm_deal_id', d.id).maybeSingle()
        if (!ja) continue
      }
      const c = d.contrato ?? {}
      const fone = d.contact?.phone || (d.contact?.wa_id ? '+' + d.contact.wa_id : '')
      const { data, error } = await plat.rpc('embarque_lead_receber', {
        p_deal: d.id,
        p_nome: c.nome || d.contact?.name || d.title,
        p_whatsapp: fone || null,
        p_email: c.email || d.contact?.email || null,
        p_cpf: c.cpf || null,
        p_vendedor: d.seller?.name || null,
        p_data: (d.stage_entered_at || d.closed_at || new Date().toISOString()).slice(0, 10),
        p_status: status,
        p_venda_sessao: d.plat_sessao_id || null,
      })
      if (error) throw error
      out.push({ deal: d.id, status, ...data })
    } catch (e) { console.error('plat-embarque', d.id, (e as Error).message) }
  }
  return json({ ok: true, enviados: out })
})
