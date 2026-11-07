import { useEffect, useState } from 'react'
import { invokeFn } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'

/* Metas combinadas para chegar às 17 vendas novas no mês (conta de novembro/2026):
   29% dos leads agendam, 87% comparecem e 27,5% das sessões realizadas viram venda. */
const META = { leadsSemana: 57, agendadasSemana: 17, realizadasSemana: 14, vendasMes: 17 }

const medalha = (i, tem) => (tem && i === 0 ? '🥇' : tem && i === 1 ? '🥈' : tem && i === 2 ? '🥉' : i + 1)

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
          <div className="mv-titulo">🏅 Ranking de vendas novas <span>do mês, pelo Registro de Sessões 1:1</span></div>
          <div className="mv-tabela">
            <table>
              <thead><tr><th>#</th><th>Consultor</th><th>Vendas</th><th>Valor do contrato</th><th title="Pix na hora + cartão por link (entra no dia seguinte, já sem a taxa da InfinitePay)">Cash collect</th><th>Sessões</th><th>No-show</th><th>Conversão</th></tr></thead>
              <tbody>
                {d.ranking.map((p, i) => (
                  <tr key={p.nome} className={i === 0 && p.vendas > 0 ? 'lider' : ''}>
                    <td>{medalha(i, p.vendas > 0)}</td>
                    <td><b>{p.nome}</b></td>
                    <td>{p.vendas}</td>
                    <td>{fmtMoney(p.valor)}</td>
                    <td>{fmtMoney(p.cash || 0)}</td>
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
      {d.ranking_upsell?.length > 0 && (
        <div className="mv-ranking mv-upsell">
          <div className="mv-titulo">🔁 Upsell e renovação <span>do mês · quem já é mentorada</span></div>
          <div className="mv-resumo">
            <span><b>{d.mes?.upsells || 0}</b> {d.mes?.upsells === 1 ? 'upsell/renovação' : 'upsells/renovações'}</span>
            <span>Valor dos novos contratos: <b>{fmtMoney(d.mes?.valor_upsell || 0)}</b></span>
            <span>Cash collect: <b>{fmtMoney(d.mes?.cash_upsell || 0)}</b></span>
          </div>
          <div className="mv-tabela">
            <table>
              <thead><tr><th>#</th><th>Consultor</th><th>Upsells</th><th>Valor do novo contrato</th><th>Cash collect</th></tr></thead>
              <tbody>
                {d.ranking_upsell.map((p, i) => (
                  <tr key={p.nome} className={i === 0 && p.valor > 0 ? 'lider' : ''}>
                    <td>{medalha(i, p.valor > 0)}</td>
                    <td><b>{p.nome}</b></td>
                    <td>{p.upsells}</td>
                    <td>{fmtMoney(p.valor)}</td>
                    <td>{fmtMoney(p.cash || 0)}</td>
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
