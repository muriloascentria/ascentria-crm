import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

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
  const [toasts, setToasts] = useState([])

  // ---- sessão ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadMeta = useCallback(async () => {
    const [p, s, pl, st, us, cf, wn] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('org_settings').select('*').eq('id', 1).single(),
      supabase.from('pipelines').select('*').order('position'),
      supabase.from('stages').select('*').order('position'),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('custom_fields').select('*').order('position'),
      supabase.from('wa_numbers').select('*').order('is_default', { ascending: false }).order('created_at'),
    ])
    setProfile(p.data ?? null)
    setSettings(s.data ?? null)
    setPipelines(pl.data ?? [])
    setStages(st.data ?? [])
    setUsers(us.data ?? [])
    setCustomFields(cf.data ?? [])
    setWaNumbers(wn.data ?? [])
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
    if (settings?.company_name) document.title = `${settings.company_name} · CRM`
  }, [settings])

  const toast = useCallback((message, kind = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500)
  }, [])

  const label = useCallback((key) => settings?.labels?.[key] ?? key, [settings])

  const value = useMemo(() => ({
    session, profile, settings, pipelines, stages, users, customFields, waNumbers,
    isAdmin: profile?.role === 'admin',
    isManager: profile?.role === 'admin' || profile?.role === 'manager',
    reload: loadMeta, toast, toasts, label,
    signOut: () => supabase.auth.signOut(),
  }), [session, profile, settings, pipelines, stages, users, customFields, waNumbers, loadMeta, toast, toasts, label])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useApp = () => useContext(Ctx)
