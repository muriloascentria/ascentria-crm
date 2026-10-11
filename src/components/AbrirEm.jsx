import { useState } from 'react'
import { getAbrirEm, setAbrirEm, ehCelular } from '../lib/manual'

/** Escolha de onde abrir a conversa no computador (salva neste navegador). No celular não aparece. */
export default function AbrirEm() {
  const [v, setV] = useState(getAbrirEm)
  if (ehCelular()) return null
  return (
    <label className="small muted row" style={{ gap: 4, alignItems: 'center' }} title="App do computador: abre na janela do WhatsApp que já está aberta, sem abrir página nova">
      Abrir em
      <select className="select" style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }} value={v}
        onChange={(e) => { setV(e.target.value); setAbrirEm(e.target.value) }}>
        <option value="app">App do WhatsApp (computador)</option>
        <option value="web">WhatsApp Web</option>
      </select>
    </label>
  )
}
