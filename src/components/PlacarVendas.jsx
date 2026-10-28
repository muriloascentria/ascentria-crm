import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MEDALHA = ['🥇', '🥈', '🥉']

/** Placar do mês para motivar a equipe: quanto foi vendido, quanto entrou na call e o ranking das consultoras. */
export default function PlacarVendas({ atualizar }) {
  const hoje = new Date()
  const [mes, setMes] = useState({ y: hoje.getFullYear(), m: hoje.getMonth() })
  const [linhas, setLinhas] = useState(null)
  useEffect(() => {
    const ini = new Date(Date.UTC(mes.y, mes.m, 1, 3)) // 00:00 em Brasília
    const fim = new Date(Date.UTC(mes.y, mes.m + 1, 1, 3))
    supabase.rpc('vendas_resumo', { p_ini: ini.toISOString(), p_fim: fim.toISOString() })
      .then(({ data, error }) => setLinhas(error ? null : data || []))
  }, [mes.y, mes.m, atualizar])
  if (linhas === null) return null
  const total = linhas.reduce((a, l) => a + Number(l.total), 0)
  const vendas = linhas.reduce((a, l) => a + l.vendas, 0)
  const entradas = linhas.reduce((a, l) => a + Number(l.entradas), 0)
  const atual = mes.y === hoje.getFullYear() && mes.m === hoje.getMonth()
  const mudar = (d) => setMes(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() } })
  return (
    <div className="placar" role="status">
      <div className="placar-mes">
        <button type="button" className="btn ghost sm" onClick={() => mudar(-1)} aria-label="Mês anterior">‹</button>
        <b>🏆 {MESES[mes.m].charAt(0).toUpperCase() + MESES[mes.m].slice(1)}{mes.y !== hoje.getFullYear() ? ` ${mes.y}` : ''}</b>
        <button type="button" className="btn ghost sm" onClick={() => mudar(1)} disabled={atual} aria-label="Próximo mês">›</button>
      </div>
      <div className="placar-num">
        <span className="placar-rot">💰 Vendido</span>
        <span className="placar-val">{fmtMoney(total)}</span>
        <span className="placar-sub">{vendas} {vendas === 1 ? 'venda' : 'vendas'}</span>
      </div>
      <div className="placar-num">
        <span className="placar-rot">💵 Recebido na call</span>
        <span className="placar-val">{fmtMoney(entradas)}</span>
        <span className="placar-sub">entradas pagas</span>
      </div>
      <div className="placar-rank">
        {linhas.length === 0 && <span className="small muted">{atual ? 'A primeira venda do mês vem aí! 🚀' : 'Nenhuma venda neste mês.'}</span>}
        {linhas.map((l, i) => (
          <span key={l.consultora} className={'placar-pessoa' + (i === 0 ? ' lider' : '')}>
            {MEDALHA[i] || '⭐'} <b>{l.consultora}</b> {fmtMoney(Number(l.total))} · {l.vendas}
          </span>
        ))}
      </div>
    </div>
  )
}
