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
