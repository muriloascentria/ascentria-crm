import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../lib/store'
import { Avatar, Toasts } from './ui'
import { ROLES } from '../lib/utils'
import { DEMO } from '../lib/supabase'
import logoEcrm from '../assets/brand/ecrm-branco.svg'
import { useState } from 'react'
import ProfileModal from './ProfileModal'

function FunnelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px' }}>
      <path d="M3 4h18l-7 8.5V19l-4 2v-8.5L3 4z" />
    </svg>
  )
}

export default function Layout() {
  const { profile, settings, signOut, isAdmin, label } = useApp()
  const [editingProfile, setEditingProfile] = useState(false)
  const items = [
    { to: '/', ico: '◫', text: label('dashboard') },
    { to: '/funil', ico: <FunnelIcon />, text: label('pipeline') },
    { to: '/contatos', ico: '☺', text: label('contacts') },
    { to: '/atividades', ico: '☑', text: label('activities') },
  ]
  if (isAdmin) items.push({ to: '/configuracoes', ico: '⚙', text: 'Configurações' })

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          {settings?.logo_url ? (
            <><img className="custom" src={settings.logo_url} alt="" /><span className="name">{settings.company_name}</span></>
          ) : (settings?.company_name || 'Ascentria').toLowerCase() === 'ascentria' ? (
            <img className="wordmark" src={logoEcrm} alt="eCRM Ascentria" />
          ) : (
            <><span className="mark">{(settings?.company_name || 'A')[0]}</span><span className="name">{settings?.company_name}</span></>
          )}
        </div>
        <nav className="nav stack">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'}><span className="ico">{i.ico}</span>{i.text}</NavLink>
          ))}
        </nav>
        <div className="me">
          <button type="button" className="me-open" onClick={() => setEditingProfile(true)} title="Meu perfil: foto e nome">
            <Avatar name={profile?.full_name || profile?.email} src={profile?.avatar_url} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--sage)' }}>{profile?.full_name || profile?.email}</div>
              <div className="small" style={{ opacity: .7 }}>{ROLES[profile?.role]}</div>
            </div>
          </button>
          <button onClick={signOut} title="Sair do sistema">sair</button>
        </div>
      </aside>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="topbar-mobile">
          {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'}>{i.text}</NavLink>)}
          <a onClick={() => setEditingProfile(true)} style={{ marginLeft: 'auto' }}>Perfil</a>
          <a onClick={signOut}>Sair</a>
        </div>
        {DEMO && <div className="demo-banner">Modo demonstração — dados fictícios; alterações valem só nesta sessão. Recarregue para voltar ao início.</div>}
        <main className="main"><Outlet /></main>
      </div>
      <Toasts />
      {editingProfile && <ProfileModal onClose={() => setEditingProfile(false)} />}
    </div>
  )
}
