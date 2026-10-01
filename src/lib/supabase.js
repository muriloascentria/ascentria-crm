import { createClient } from '@supabase/supabase-js'
import { mockClient } from './mock'

export const DEMO = import.meta.env.VITE_DEMO === '1'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!DEMO && (!url || !key)) {
  // eslint-disable-next-line no-console
  console.error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env')
}

export const supabase = DEMO
  ? mockClient
  : createClient(url ?? 'https://invalid.supabase.co', key ?? 'anon', { auth: { persistSession: true, autoRefreshToken: true } })

export const SESSION_ENDED = 'Sua sessão terminou. Entre de novo no CRM.'

/**
 * Chama uma Edge Function. Se a sessão foi encerrada (resposta 401), tenta renovar uma vez;
 * se não der, sai só deste navegador e manda para a tela de entrada com um aviso claro
 * (em vez de ficar mostrando "Não autenticado" a cada envio).
 */
export async function invokeFn(name, options) {
  let r = await supabase.functions.invoke(name, options)
  if (DEMO || r.error?.context?.status !== 401) return r
  const { error: refreshErr } = await supabase.auth.refreshSession()
  if (!refreshErr) {
    r = await supabase.functions.invoke(name, options)
    if (r.error?.context?.status !== 401) return r
  }
  await supabase.auth.signOut({ scope: 'local' })
  return { data: null, error: new Error(SESSION_ENDED) }
}
