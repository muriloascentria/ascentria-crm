import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../lib/store'
import { Avatar, Toasts } from './ui'
import { ROLES } from '../lib/utils'
import { DEMO } from '../lib/supabase'
import logoSage from '../assets/brand/logo-sage.png'

export default function Layout() {
  const { profile, settings, signOut, isAdmin, label } = useApp()
  const items = [
    { to: '/', ico: '◫', text: label('dashboard') },
    { to: '/funil', ico: '⫶', text: label('pipeline') },
    { to: '/contatos', ico: '☺', text: label('contacts') },
    { to: '/empresas', ico: '▣', text: label('companies') },
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
            <img className="wordmark" src={logoSage} alt="Ascentria — terapia e saúde integrativa" />
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
          <Avatar name={profile?.full_name || profile?.email} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.full_name || profile?.email}</div>
            <div className="small" style={{ opacity: .7 }}>{ROLES[profile?.role]} · <button onClick={signOut}>sair</button></div>
          </div>
        </div>
      </aside>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="topbar-mobile">
          {items.map((i) => <NavLink key={i.to} to={i.to} end={i.to === '/'}>{i.text}</NavLink>)}
          <a onClick={signOut} style={{ marginLeft: 'auto' }}>Sair</a>
        </div>
        {DEMO && <div className="demo-banner">Modo demonstração — dados fictícios; alterações valem só nesta sessão. Recarregue para voltar ao início.</div>}
        <main className="main"><Outlet /></main>
      </div>
      <Toasts />
    </div>
  )
}
