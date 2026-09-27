import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Política de segurança de conteúdo (CSP) do build de produção: o navegador só executa scripts do próprio site
// e só conversa com o Supabase do projeto. Bloqueia injeção de scripts de terceiros (XSS) e vazamento de dados.
function cspPlugin(supabaseUrl) {
  let sb = 'https://*.supabase.co'
  try { if (supabaseUrl) sb = new URL(supabaseUrl).origin } catch { /* mantém o curinga */ }
  const ws = sb.replace(/^https:/, 'wss:')
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${sb} ${ws}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`),
  }
}

// `npm run build:demo` gera um único arquivo HTML (dist-demo/index.html) com dados fictícios,
// útil para testar a interface sem banco de dados.
export default defineConfig(({ mode }) => {
  const demo = process.env.VITE_DEMO === '1'
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL
  return {
    plugins: [react(), ...(demo ? [viteSingleFile()] : [cspPlugin(supabaseUrl)])],
    build: { outDir: demo ? 'dist-demo' : 'dist', chunkSizeWarningLimit: 1200, assetsInlineLimit: demo ? 10_000_000 : 4096, sourcemap: false },
  }
})
