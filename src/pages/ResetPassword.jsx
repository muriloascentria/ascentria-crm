import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Field } from '../components/ui'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState(null)
  const nav = useNavigate()
  const submit = async (e) => {
    e.preventDefault()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return setMsg(error.message)
    nav('/')
  }
  return (
    <div className="auth">
      <form className="card stack" onSubmit={submit}>
        <h1>Crie sua senha</h1>
        <p className="small muted" style={{ margin: 0 }}>Defina a senha que você vai usar para entrar no CRM.</p>
        <Field label="Senha"><input className="input" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {msg && <div className="small" style={{ color: 'var(--danger)' }}>{msg}</div>}
        <button className="btn primary">Salvar</button>
      </form>
    </div>
  )
}
