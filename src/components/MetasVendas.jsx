import { useEffect, useState } from 'react'
import { invokeFn } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'

/* Metas combinadas para chegar às 17 vendas novas no mês (conta de novembro/2026):
   29% dos leads agendam, 87% comparecem e 27,5% das sessões realizadas viram venda. */
const META = { leadsSemana: 57, agendadasSemana: 17, realizadasSemana: 14, vendasMes: 17 }

function Bloco({ rot, valor, meta, sufixo }) {
  const pct = meta ? Math.min(100, Math.round((valor / meta) * 100)) : 0
  const ok = valor >= meta
  const falta = Math.max(0, meta - valor)
  return (
    <div className={'mv-bloco' + (ok ? ' ok' : '')}>
      <div className="mv-rot">{rot}</div>
      <div className="mv-num"><b>{valor}</b> de {meta}{sufixo ? ` ${sufixo}` : ''}</div>
      <div className="mv-barra"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
      <div className="mv-falta">{ok ? 'Meta batida' : <>Faltam <b>{falta}</b></>}</div>
    </div>
  )
}

/** Metas da semana (leads, sessões agendadas e realizadas), vendas do mês e ranking dos consultores. */
export default function MetasVendas({ atualizar }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    let vivo = true
    invokeFn('metas-vendas', { body: {} }).then(({ data, error }) => { if (vivo && !error && data && !data.error) setD(data) })
    return () => { vivo = false }
  }, [atualizar])
  if (!d) return null
  const ini = d.semana_ini ? `${d.semana_ini.slice(8, 10)}/${d.semana_ini.slice(5, 7)}` : ''
  const tudoOk = d.leads >= META.leadsSemana && d.agendadas >= META.agendadasSemana && d.semana.realizadas >= META.realizadasSemana
  return (
    <div className={'metas-vendas' + (tudoOk ? ' ok' : '')} role="status">
      <div className="mv-titulo">🎯 Metas da semana <span>desde segunda, {ini}</span></div>
      <div className="mv-grid">
        <Bloco rot="Leads novos" valor={d.leads} meta={META.leadsSemana} />
        <Bloco rot="Sessões agendadas" valor={d.agendadas} meta={META.agendadasSemana} />
        <Bloco rot="Sessões realizadas" valor={d.semana.realizadas} meta={META.realizadasSemana} />
        <Bloco rot="Vendas do mês" valor={d.mes.vendas} meta={META.vendasMes} />
      </div>
      {d.ranking?.length > 0 && (
        <div className="mv-ranking">
          <div className="mv-titulo">🏅 Ranking dos consultores <span>vendas novas do mês, pelo Registro de Sessões 1:1</span></div>
          <div className="mv-tabela">
            <table>
              <thead><tr><th>#</th><th>Consultor</th><th>Vendas</th><th>Valor vendido</th><th title="Pix na hora + cartão por link (entra no dia seguinte, já sem a taxa da InfinitePay). Inclui upsell.">Cash collect</th><th>Sessões</th><th>No-show</th><th>Conversão</th></tr></thead>
              <tbody>
                {d.ranking.map((p, i) => (
                  <tr key={p.nome} className={i === 0 && p.vendas > 0 ? 'lider' : ''}>
                    <td>{i === 0 && p.vendas > 0 ? '🥇' : i === 1 && p.vendas > 0 ? '🥈' : i === 2 && p.vendas > 0 ? '🥉' : i + 1}</td>
                    <td><b>{p.nome}</b>{p.upsells ? <span className="small muted"> · +{p.upsells} upsell{p.upsells > 1 ? 's' : ''}</span> : null}</td>
                    <td>{p.vendas}</td>
                    <td>{fmtMoney(p.valor)}{p.valor_upsell ? <div className="small muted">+ {fmtMoney(p.valor_upsell)} de upsell</div> : null}</td>
                    <td>{fmtMoney(p.cash || 0)}{p.cash_upsell ? <div className="small muted">{fmtMoney(p.cash_upsell)} de upsell</div> : null}</td>
                    <td>{p.sessoes}</td>
                    <td>{p.noshow}</td>
                    <td>{String(p.conversao).replace('.', ',')}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
