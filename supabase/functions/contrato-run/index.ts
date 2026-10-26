// Acompanha os contratos enviados para assinatura (reserva do webhook da Autentique): a cada poucos minutos
// confere na Autentique quem já assinou e atualiza o card (o aviso "o lead assinou" aparece no CRM).
// Chamada pelo cron com Authorization: Bearer <cron_secret>.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { aplicarAndamento, autentiqueOn, buscarDocumento } from '../_shared/autentique.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const t = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: ok } = await admin.rpc('check_cron_secret', { p: t })
  if (!ok) return json({ error: 'não autorizado' }, 401)
  if (!autentiqueOn()) return json({ ok: true, info: 'Autentique não configurada' })
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const { data: deals } = await admin.from('deals').select('id, contrato_autentique_id, contrato_status, contrato_assinaturas')
    .eq('contrato_status', 'enviado').not('contrato_autentique_id', 'is', null).gte('contrato_gerado_em', desde).limit(30)
  const out: any[] = []
  for (const d of deals ?? []) {
    try {
      const doc = await buscarDocumento(d.contrato_autentique_id)
      if (!doc) continue
      const antes = JSON.stringify(d.contrato_assinaturas ?? [])
      const r = await aplicarAndamento(admin, d.id, doc)
      if (JSON.stringify(r.assinaturas) !== antes || r.status !== d.contrato_status) out.push({ id: d.id, status: r.status })
    } catch (e) { console.error('contrato-run', d.id, (e as Error).message) }
  }
  return json({ ok: true, conferidos: deals?.length ?? 0, atualizados: out })
})
