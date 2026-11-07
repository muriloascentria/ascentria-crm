import { useEffect, useState } from 'react'
import { invokeFn } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'
import PlacarVendas from './PlacarVendas'

/* Metas combinadas para chegar às 17 vendas novas no mês (conta de novembro/2026):
   29% dos leads agendam, 87% comparecem e 27,5% das sessões realizadas viram venda. */
const META = { leadsSemana: 57, agendadasSemana: 17, realizadasSemana: 14, vendasMes: 17 }

const medalha = (i, tem) => (tem && i === 0 ? '🥇' : tem && i === 1 ? '🥈' : tem && i === 2 ? '🥉' : i + 1)

function Bloco({ rot, valor, meta, sufixo, mes }) {
  const pct = meta ? Math.min(100, Math.round((valor / meta) * 100)) : 0
  const ok = valor >= meta
  const falta = Math.max(0, meta - valor)
  return (
    <div className={'mv-bloco' + (ok ? ' ok' : '')}>
      <div className="mv-rot">{rot}</div>
      <div className="mv-num"><b>{valor}</b> de {meta}{sufixo ? ` ${sufixo}` : ''}</div>
      <div className="mv-barra"><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
      <div className="mv-falta">{ok ? 'Meta batida' : <>Faltam <b>{falta}</b></>}</div>
      {mes && <div className="mv-mes">{mes}</div>}
    </div>
  )
}

/** Objeções registradas pelos consultores, por tipo (atualiza sozinho a cada registro de sessão). */
function Objecoes({ titulo, mes, d90 }) {
  const [periodo, setPeriodo] = useState('mes')
  const o = periodo === 'mes' ? mes : d90
  if (!mes && !d90) return null
  return (
    <div className="mv-objecoes">
      <div className="mv-obj-cab">
        <div className="mv-titulo">🧱 {titulo} <span>pelo que os consultores registram depois da sessão</span></div>
        <div className="mv-obj-periodo">
          <button type="button" className={periodo === 'mes' ? 'on' : ''} onClick={() => setPeriodo('mes')}>Este mês</button>
          <button type="button" className={periodo === 'd90' ? 'on' : ''} onClick={() => setPeriodo('d90')}>Últimos 90 dias</button>
        </div>
      </div>
      {!o?.total ? <div className="small muted">Nenhuma objeção registrada {periodo === 'mes' ? 'neste mês' : 'nos últimos 90 dias'}.</div> : (
        <>
          <div className="mv-obj-lista">
            {o.tipos.map((t) => (
              <div key={t.tipo} className="mv-obj">
                <div className="mv-obj-linha"><b>{t.tipo}</b><span><b>{String(t.pct).replace('.', ',')}%</b> · {t.total}{t.contornadas ? ` · ${t.contornadas} contornada${t.contornadas > 1 ? 's' : ''} (vendeu)` : ''}</span></div>
                <div className="mv-barra"><i style={{ width: `${Math.max(3, t.pct)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="mv-mes">{o.total} {o.total === 1 ? 'objeção' : 'objeções'} em {o.sessoes} {o.sessoes === 1 ? 'sessão' : 'sessões'} realizadas</div>
        </>
      )}
    </div>
  )
}

/** Metas da semana (leads, sessões agendadas e realizadas), vendas do mês e ranking dos consultores. */
export default function MetasVendas({ atualizar }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    let vivo = true
    const carregar = () => invokeFn('metas-vendas', { body: {} }).then(({ data, error }) => { if (vivo && !error && data && !data.error) setD(data) })
    carregar()
    const iv = setInterval(carregar, 120_000) // registros novos de sessão entram sozinhos
    return () => { vivo = false; clearInterval(iv) }
  }, [atualizar])
  if (!d) return null
  const ini = d.semana_ini ? `${d.semana_ini.slice(8, 10)}/${d.semana_ini.slice(5, 7)}` : ''
  const M = d.metas ? { leadsSemana: d.metas.leads, agendadasSemana: d.metas.agendadas, realizadasSemana: d.metas.realizadas, vendasMes: d.metas.vendas_mes } : META
  const mm = d.metas?.mes, fm = d.metas?.feito_mes
  const tudoOk = d.leads >= M.leadsSemana && d.agendadas >= M.agendadasSemana && d.semana.realizadas >= M.realizadasSemana
  return (
    <div className={'metas-vendas' + (tudoOk ? ' ok' : '')} role="status">
      <div className="mv-titulo">🎯 Metas da semana <span>desde {ini} · o que faltou nas semanas anteriores já está somado</span></div>
      <div className="mv-grid">
        <Bloco rot="Leads novos" valor={d.leads} meta={M.leadsSemana} mes={mm && fm ? `${fm.leads} de ${mm.leads} no mês` : null} />
        <Bloco rot="Sessões agendadas" valor={d.agendadas} meta={M.agendadasSemana} mes={mm && fm ? `${fm.agendadas} de ${mm.agendadas} no mês` : null} />
        <Bloco rot="Sessões realizadas" valor={d.semana.realizadas} meta={M.realizadasSemana} mes={mm && fm ? `${fm.realizadas} de ${mm.realizadas} no mês` : null} />
        <Bloco rot="Vendas do mês" valor={d.mes.vendas} meta={M.vendasMes} />
      </div>
      {d.comparecimento && (
        <div className="mv-compar">
          <span>📅 <b>Comparecimento do time</b> (sessões de vendas novas)</span>
          <span>Semana: <b>{d.comparecimento.semana.pct == null ? '—' : String(d.comparecimento.semana.pct).replace('.', ',') + '%'}</b> ({d.comparecimento.semana.show} vieram · {d.comparecimento.semana.noshow} no-show)</span>
          <span>Mês: <b>{d.comparecimento.mes.pct == null ? '—' : String(d.comparecimento.mes.pct).replace('.', ',') + '%'}</b> ({d.comparecimento.mes.show} vieram · {d.comparecimento.mes.noshow} no-show)</span>
        </div>
      )}
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
      {d.objecoes && <Objecoes titulo="Objeções nas vendas novas" mes={d.objecoes.mes} d90={d.objecoes.d90} />}
      {d.ranking_upsell?.length > 0 && (
        <div className="mv-ranking mv-upsell">
          <div className="mv-titulo">🔁 Upsell e renovação <span>do mês · quem já é mentorada</span></div>
          <PlacarVendas tipo="upsell" atualizar={atualizar} />
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
          {d.objecoes && <Objecoes titulo="Objeções no upsell e renovação" mes={d.objecoes.mes_upsell} d90={d.objecoes.d90_upsell} />}
        </div>
      )}
    </div>
  )
}
