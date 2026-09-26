import { Navigate, Route, Routes } from 'react-router-dom'
import { useApp } from './lib/store'
import Layout from './components/Layout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import Contacts from './pages/Contacts'
import Companies from './pages/Companies'
import Activities from './pages/Activities'
import Settings from './pages/Settings'

function Pending() {
  const { profile, signOut, reload } = useApp()
  return (
    <div className="auth">
      <div className="card stack" style={{ textAlign: 'center' }}>
        <h1>Aguardando aprovação</h1>
        <p className="muted">Olá, {profile?.full_name || profile?.email}. Sua conta foi criada, mas um administrador precisa ativá-la antes de você acessar o CRM.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={reload}>Verificar novamente</button>
          <button className="btn ghost" onClick={signOut}>Sair</button>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { session, profile, settings, isAdmin } = useApp()

  if (session === undefined) return <div className="auth"><div className="card">Carregando…</div></div>

  if (!session) {
    return (
      <Routes>
        <Route path="/redefinir-senha" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  if (!profile || !settings) return <div className="auth"><div className="card">Carregando seu perfil…</div></div>
  if (!profile.active) return <Pending />

  return (
    <Routes>
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/funil" element={<Pipeline />} />
        <Route path="/contatos" element={<Contacts />} />
        <Route path="/contatos/:id" element={<Contacts />} />
        <Route path="/empresas" element={<Companies />} />
        <Route path="/empresas/:id" element={<Companies />} />
        <Route path="/atividades" element={<Activities />} />
        {isAdmin && <Route path="/configuracoes" element={<Settings />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
