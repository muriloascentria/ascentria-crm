import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Field } from '../components/ui'

// Senha forte: 10+ caracteres com letras e números (o CRM guarda dados pessoais de leads e clientes).
function problema(p) {
  if (p.length < 10) return 'Use pelo menos 10 caracteres.'
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'Misture letras e números.'
  return null
}

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const submit = async (e) => {
    e.preventDefault()
    const p = problema(password)
    if (p) return setMsg(p)
    if (password !== confirm) return setMsg('As duas senhas não são iguais.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setMsg(/pwned|leaked|compromised/i.test(error.message) ? 'Essa senha apareceu em vazamentos na internet. Escolha outra.' : error.message)
    nav('/')
  }
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <h1>Crie sua senha</h1>
        <p className="small muted" style={{ margin: 0 }}>Pelo menos 10 caracteres, misturando letras e números.</p>
        <Field label="Senha"><input className="input" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Repita a senha"><input className="input" type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        {msg && <div className="small" style={{ color: 'var(--danger)' }}>{msg}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </form>
    </div>
  )
}
