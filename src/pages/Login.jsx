import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Field } from '../components/ui'
import { DEMO } from '../lib/supabase'
import logoEcrm from '../assets/brand/ecrm-verde.svg'

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
        if (error) throw error
        if (!data.session) setMsg({ ok: true, text: 'Conta criada. Verifique seu e-mail para confirmar o cadastro.' })
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/redefinir-senha' })
        if (error) throw error
        setMsg({ ok: true, text: 'Enviamos um link de redefinição para o seu e-mail.' })
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
          <h1>{mode === 'login' ? 'Entrar no CRM' : mode === 'signup' ? 'Criar conta' : 'Recuperar senha'}</h1>
        </div>
        {mode === 'signup' && <Field label="Seu nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>}
        <Field label="E-mail"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        {mode !== 'reset' && <Field label="Senha"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field>}
        {DEMO && <div className="small muted" style={{ background: '#fff7e6', padding: 8, borderRadius: 6 }}>Modo demonstração: qualquer e-mail e senha entram como administrador.</div>}
        {msg && <div className="small" style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
        <button className="btn primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Criar conta' : 'Enviar link'}
        </button>
        <div className="small muted" style={{ textAlign: 'center' }}>
          {mode === 'login' ? (
            <>
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup') }}>Criar conta</a> · <a href="#" onClick={(e) => { e.preventDefault(); setMode('reset') }}>Esqueci a senha</a>
            </>
          ) : (
            <a href="#" onClick={(e) => { e.preventDefault(); setMode('login') }}>Já tenho conta</a>
          )}
        </div>
      </form>
    </div>
  )
}

function traduz(m = '') {
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.'
  if (/already registered/i.test(m)) return 'Este e-mail já está cadastrado.'
  if (/email not confirmed/i.test(m)) return 'Confirme seu e-mail antes de entrar.'
  if (/password/i.test(m) && /6/.test(m)) return 'A senha deve ter pelo menos 6 caracteres.'
  return m
}
