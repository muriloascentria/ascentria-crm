import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, DEMO } from './supabase'

const Ctx = createContext(null)

export function AppProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = carregando
  const [profile, setProfile] = useState(null)
  const [settings, setSettings] = useState(null)
  const [pipelines, setPipelines] = useState([])
  const [stages, setStages] = useState([])
  const [users, setUsers] = useState([])
  const [customFields, setCustomFields] = useState([])
  const [waNumbers, setWaNumbers] = useState([])
  const [sellers, setSellers] = useState([])
  const [toasts, setToasts] = useState([])

  // ---- sessão ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  // ---- saída automática após 8 horas sem uso (protege o CRM em computador esquecido aberto) ----
  useEffect(() => {
    if (!session || DEMO) return
    const KEY = 'crm.lastActive', LIMIT = 8 * 60 * 60 * 1000
    const get = () => { try { return Number(localStorage.getItem(KEY)) || 0 } catch { return 0 } }
    const touch = () => { try { localStorage.setItem(KEY, String(Date.now())) } catch { /* sem armazenamento: segue sem o controle */ } }
    // Acabou de entrar (login depois do último uso registrado): começa a contar de novo,
    // em vez de sair na hora por causa do horário antigo guardado neste navegador.
    const signedInAt = Date.parse(session.user?.last_sign_in_at || '') || 0
    if (get() < signedInAt) touch()
    const check = () => {
      const last = get()
      // sai só DESTE navegador: não derruba a mesma conta aberta em outro computador/celular
      if (last && Date.now() - last > LIMIT) { try { localStorage.removeItem(KEY) } catch { /* ignora */ } supabase.auth.signOut({ scope: 'local' }) }
    }
    check(); touch()
    let t = 0
    const onActivity = () => { const now = Date.now(); if (now - t > 60_000) { t = now; touch() } }
    const evs = ['pointerdown', 'keydown', 'scroll', 'visibilitychange']
    evs.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const iv = setInterval(check, 5 * 60 * 1000)
    return () => { evs.forEach((e) => window.removeEventListener(e, onActivity)); clearInterval(iv) }
  }, [session])

  const loadMeta = useCallback(async () => {
    const [p, s, pl, st, us, cf, wn, cs] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('org_settings').select('*').eq('id', 1).single(),
      supabase.from('pipelines').select('*').order('position'),
      supabase.from('stages').select('*').order('position'),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('custom_fields').select('*').order('position'),
      supabase.from('wa_numbers').select('*').order('is_default', { ascending: false }).order('created_at'),
      supabase.from('calendar_sellers').select('*').order('position').order('name'),
    ])
    setProfile(p.data ?? null)
    setSettings(s.data ?? null)
    setPipelines(pl.data ?? [])
    setStages(st.data ?? [])
    setUsers(us.data ?? [])
    setCustomFields(cf.data ?? [])
    setWaNumbers(wn.data ?? [])
    setSellers(cs.data ?? [])
  }, [session])

  useEffect(() => {
    if (session) loadMeta()
    else { setProfile(null); setSettings(null) }
  }, [session, loadMeta])

  // ---- tema (cores da marca) ----
  useEffect(() => {
    const root = document.documentElement
    if (settings?.primary_color) root.style.setProperty('--primary', settings.primary_color)
    if (settings?.accent_color) root.style.setProperty('--accent', settings.accent_color)
  }, [settings])

  const toast = useCallback((message, kind = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])

  const label = useCallback((key) => settings?.labels?.[key] ?? key, [settings])

  const value = useMemo(() => ({
    session, profile, settings, pipelines, stages, users, customFields, waNumbers, sellers,
    isAdmin: profile?.role === 'admin',
    isManager: profile?.role === 'admin' || profile?.role === 'manager',
    reload: loadMeta, toast, toasts, label,
    signOut: () => supabase.auth.signOut({ scope: 'local' }),
  }), [session, profile, settings, pipelines, stages, users, customFields, waNumbers, sellers, loadMeta, toast, toasts, label])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useApp = () => useContext(Ctx)
