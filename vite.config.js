import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:demo` gera um único arquivo HTML (dist-demo/index.html) com dados fictícios,
// útil para testar a interface sem banco de dados.
export default defineConfig(({ mode }) => {
  const demo = process.env.VITE_DEMO === '1'
  return {
    plugins: [react(), ...(demo ? [viteSingleFile()] : [])],
    build: { outDir: demo ? 'dist-demo' : 'dist', chunkSizeWarningLimit: 1200, assetsInlineLimit: demo ? 10_000_000 : 4096 },
  }
})
