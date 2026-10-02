// Convida uma pessoa para o CRM (somente administradores).
// Envia o e-mail de convite do Supabase Auth; o link leva para /redefinir-senha, onde a pessoa cria a senha.
// O perfil já nasce ativo, com o papel escolhido (não passa por "Aguardando aprovação").
// Body: { email, full_name?, role: 'admin' | 'manager' | 'seller' }
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/wa.ts'

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://ecrm.digital'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autorizado' }, 401)
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', user.id).single()
  if (!me?.active || me.role !== 'admin') return json({ error: 'Apenas administradores podem convidar' }, 403)

  const body = await req.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const fullName = String(body.full_name ?? '').trim()
  const role = ['admin', 'manager', 'seller'].includes(body.role) ? body.role : 'seller'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'E-mail inválido.' })

  const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()

  // Reenviar acesso para quem já tem conta: convite de novo (se nunca aceitou) ou link para criar nova senha.
  if (body.resend === true) {
    if (!existing) return json({ ok: false, error: 'Não existe conta com este e-mail.' })
    const { data: au } = await admin.auth.admin.getUserById(existing.id)
    const aceitou = !!au?.user?.email_confirmed_at
    const redirectTo = `${SITE_URL}/redefinir-senha`
    let tipo = aceitou ? 'senha' : 'convite'
    let { error: rErr } = aceitou
      ? await admin.auth.resetPasswordForEmail(email, { redirectTo })
      : await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (rErr && !aceitou) {
      // se o servidor não aceitar um segundo convite, manda o link de criar senha
      ;({ error: rErr } = await admin.auth.resetPasswordForEmail(email, { redirectTo }))
      tipo = 'senha'
    }
    if (rErr) return json({ ok: false, error: rErr.message })
    return json({ ok: true, email, resent: tipo })
  }

  if (existing) return json({ ok: false, error: 'Já existe uma conta com este e-mail. Ajuste o perfil dela na lista.' })

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/redefinir-senha`,
    data: fullName ? { full_name: fullName } : undefined,
  })
  if (error || !data?.user) return json({ ok: false, error: error?.message ?? 'Não foi possível enviar o convite.' })

  const patch: Record<string, unknown> = { role, active: true }
  if (fullName) patch.full_name = fullName
  const { error: pErr } = await admin.from('profiles').update(patch).eq('id', data.user.id)
  if (pErr) return json({ ok: false, error: 'Convite enviado, mas não foi possível ajustar o perfil: ' + pErr.message })

  return json({ ok: true, email })
})
