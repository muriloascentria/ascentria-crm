import { useEffect, useState } from 'react'

/**
 * Avisa quando sai uma versão nova do CRM: compara o arquivo principal (assets/index-xxxx.js) da página aberta
 * com o do site publicado. Evita alguém trabalhar horas numa versão antiga guardada no navegador.
 */
const scriptAtual = () => [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).find((s) => /\/assets\/index-.*\.js$/.test(s || '')) || null

export default function NovaVersao() {
  const [nova, setNova] = useState(false)
  useEffect(() => {
    const atual = scriptAtual()
    if (!atual) return // modo de desenvolvimento
    const conferir = async () => {
      try {
        const r = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' })
        const html = await r.text()
        const publicado = html.match(/\/assets\/index-[^"']+\.js/)?.[0]
        if (publicado && !atual.endsWith(publicado)) setNova(true)
      } catch { /* sem internet: confere na próxima */ }
    }
    conferir()
    const iv = setInterval(conferir, 5 * 60_000)
    const aoVoltar = () => { if (document.visibilityState === 'visible') conferir() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [])
  if (!nova) return null
  return (
    <div className="aviso-som" role="status" style={{ background: '#e8f0fe', borderColor: '#9cc0f5', color: '#12366e' }}>
      <span>✨ Saiu uma versão nova do CRM. Atualize para ver as últimas mudanças.</span>
      <button type="button" className="btn sm primary" onClick={() => location.reload()}>Atualizar agora</button>
    </div>
  )
}
