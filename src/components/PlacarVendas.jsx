import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** Placar do mês da equipe. tipo 'novas': vendas novas (valor do contrato e cash collect).
 *  tipo 'upsell': upsell e renovação de quem já é mentorada (valor do novo contrato e cash collect). */
export default function PlacarVendas({ atualizar, tipo = 'novas', mes: mesFora, onMes }) {
  const up = tipo === 'upsell'
  const hoje = new Date()
  const [mesDentro, setMesDentro] = useState({ y: hoje.getFullYear(), m: hoje.getMonth() })
  // o mês pode vir de fora (funil): aí as setas trocam o mês de todos os indicadores juntos
  const mes = mesFora || mesDentro
  const setMes = (f) => (onMes ? onMes(f(mes)) : setMesDentro(f))
  const [linhas, setLinhas] = useState(null)
  useEffect(() => {
    const ini = new Date(Date.UTC(mes.y, mes.m, 1, 3)) // 00:00 em Brasília
    const fim = new Date(Date.UTC(mes.y, mes.m + 1, 1, 3))
    if (up) {
      const dia = (d) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10)
      supabase.from('caixa_lancamentos').select('liquido, valor_contrato').eq('tipo', 'upsell').gte('data', dia(ini)).lt('data', dia(fim))
        .then(({ data, error }) => {
          if (error) return setLinhas(null)
          const l = data || []
          setLinhas([{ vendas: l.filter((x) => x.valor_contrato != null).length, total: l.reduce((a, x) => a + (Number(x.valor_contrato) || 0), 0), entradas: l.reduce((a, x) => a + (Number(x.liquido) || 0), 0) }])
        })
      return
    }
    supabase.rpc('vendas_resumo', { p_ini: ini.toISOString(), p_fim: fim.toISOString() })
      .then(({ data, error }) => setLinhas(error ? null : data || []))
  }, [mes.y, mes.m, atualizar, up])
  if (linhas === null) return null
  const r = linhas[0] || {}
  const total = Number(r.total || 0), vendas = Number(r.vendas || 0), entradas = Number(r.entradas || 0)
  const atual = mes.y === hoje.getFullYear() && mes.m === hoje.getMonth()
  const mudar = (d) => setMes(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() } })
  return (
    <div className={'placar' + (up ? ' placar-upsell' : '')} role="status">
      <div className="placar-mes">
        <button type="button" className="placar-seta" onClick={() => mudar(-1)} aria-label="Ver mês anterior" title="Ver mês anterior">◀</button>
        <b>{up ? '🔁' : '🏆'} {MESES[mes.m].charAt(0).toUpperCase() + MESES[mes.m].slice(1)}{mes.y !== hoje.getFullYear() ? ` ${mes.y}` : ''}</b>
        <button type="button" className="placar-seta" onClick={() => mudar(1)} disabled={atual} aria-label="Ver próximo mês" title="Ver próximo mês">▶</button>
      </div>
      <div className="placar-num">
        <span className="placar-rot">💰 {up ? 'Upsell/renovação · valor do novo contrato' : 'Vendas novas · valor do contrato'}</span>
        <span className="placar-val">{fmtMoney(total)}</span>
        <span className="placar-sub">{vendas} {up ? (vendas === 1 ? 'upsell/renovação' : 'upsells/renovações') : (vendas === 1 ? 'venda nova' : 'vendas novas')}</span>
      </div>
      <div className="placar-num">
        <span className="placar-rot">💵 {up ? 'Upsell/renovação' : 'Vendas novas'} · cash collect</span>
        <span className="placar-val">{fmtMoney(entradas)}</span>
      </div>
      {vendas === 0 && <span className="small muted">{up ? (atual ? 'Nenhum upsell ainda neste mês.' : 'Nenhum upsell neste mês.') : atual ? 'A primeira venda do mês vem aí! 🚀' : 'Nenhuma venda neste mês.'}</span>}
    </div>
  )
}
