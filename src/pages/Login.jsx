import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Field } from '../components/ui'
import { DEMO } from '../lib/supabase'
import logoEcrm from '../assets/brand/ecrm-escuro.svg'

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/redefinir-senha' })
        if (error) throw error
        setMsg({ ok: true, text: 'Se este e-mail tiver acesso ao CRM, enviamos um link de redefinição.' })
      }
    } catch (err) {
      setMsg({ ok: false, text: traduz(err.message) })
    } finally { setBusy(false) }
  }

  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit} style={{ gap: 14 }}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <img className="logo" src={logoEcrm} alt="eCRM Ascentria" />
          <h1>{mode === 'login' ? 'Entrar no CRM' : 'Recuperar senha'}</h1>
        </div>
        <Field label="E-mail"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        {mode !== 'reset' && <Field label="Senha"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>}
        {DEMO && <div className="small muted" style={{ background: '#fff7e6', padding: 8, borderRadius: 6 }}>Modo demonstração: qualquer e-mail e senha entram como administrador.</div>}
        {msg && <div className="small" style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
        <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Enviar link'}
        </button>
        <div className="small muted" style={{ textAlign: 'center' }}>
          {mode === 'login' ? (
            <>
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('reset') }}>Esqueci a senha</a>
              <div style={{ marginTop: 6 }}>Acesso somente por convite do administrador.</div>
            </>
          ) : (
            <a href="#" onClick={(e) => { e.preventDefault(); setMode('login') }}>Voltar para o login</a>
          )}
        </div>
      </form>
    </div>
  )
}

function traduz(m = '') {
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.'
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
  if (/email not confirmed/i.test(m)) return 'Confirme seu e-mail antes de entrar.'
  if (/password/i.test(m) && /6/.test(m)) return 'A senha deve ter pelo menos 6 caracteres.'
  return m
}
