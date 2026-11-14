import { useEffect, useState } from 'react'
import { invokeFn } from '../lib/supabase'
import { fmtMoney } from '../lib/utils'
import PlacarVendas from './PlacarVendas'

/* Metas combinadas para chegar às 17 vendas novas no mês (conta de novembro/2026):
   29% dos leads agendam, 87% comparecem e 27,5% das sessões realizadas viram venda. */
const META = { leadsSemana: 57, agendadasSemana: 17, realizadasSemana: 14, vendasMes: 17 }

// Ordem do ranking de vendas novas: nº de vendas, depois taxa de conversão, cash collect e valor do contrato
const ordemRanking = (a, b) => b.vendas - a.vendas || b.conversao - a.conversao || (b.cash || 0) - (a.cash || 0) || b.valor - a.valor

// Conversão = vendas feitas em sessão ÷ sessões realizadas (venda fechada depois, sem sessão no Plat, não entra na conta)
const convSessoes = (p) => ({ ...p, conversao: p.sessoes ? Math.round((p.vendas - (p.sem_sessao || 0)) / p.sessoes * 1000) / 10 : 0 })

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
  const [aberto, setAberto] = useState(null)
  const o = periodo === 'mes' ? mes : d90
  const dt = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '')
  if (!mes && !d90) return null
  return (
    <div className="mv-objecoes">
      <div className="mv-obj-cab">
        <div className="mv-titulo">🧱 {titulo} <span>pelo que os consultores registram depois da sessão</span></div>
        <div className="mv-obj-periodo">
          <button type="button" className={periodo === 'mes' ? 'on' : ''} onClick={() => setPeriodo('mes')}>No mês</button>
          <button type="button" className={periodo === 'd90' ? 'on' : ''} onClick={() => setPeriodo('d90')}>Últimos 90 dias</button>
        </div>
      </div>
      {!o?.total ? <div className="small muted">Nenhuma objeção registrada {periodo === 'mes' ? 'neste mês' : 'nos últimos 90 dias'}.</div> : (
        <>
          <div className="mv-obj-lista">
            {o.tipos.map((t) => (
              <div key={t.tipo} className={'mv-obj' + (aberto === t.tipo ? ' aberto' : '')}>
                <button type="button" className="mv-obj-btn" onClick={() => setAberto(aberto === t.tipo ? null : t.tipo)} title="Ver o que os consultores escreveram">
                  <div className="mv-obj-linha"><b>{aberto === t.tipo ? '▾' : '▸'} {t.tipo}</b><span><b>{String(t.pct).replace('.', ',')}%</b></span></div>
                  <div className="mv-barra"><i style={{ width: `${Math.max(3, t.pct)}%` }} /></div>
                </button>
                {aberto === t.tipo && (
                  <div className="mv-obj-exemplos">
                    <div className="mv-obj-ex-cab">{t.total} {t.total === 1 ? 'vez' : 'vezes'}{t.contornadas ? ` · ${t.contornadas} contornada${t.contornadas > 1 ? 's' : ''} (a sessão virou venda)` : ' · nenhuma contornada'}</div>
                    {(t.exemplos || []).map((e, i) => (
                      <div key={i} className="mv-obj-ex">
                        <div className="mv-obj-ex-cab"><b>{e.lead}</b> · {e.vendedor} · {dt(e.data)}{e.resultado ? ` · ${e.resultado}` : ''}</div>
                        <div>{e.texto}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mv-mes">{o.total} {o.total === 1 ? 'objeção' : 'objeções'} em {o.sessoes} {o.sessoes === 1 ? 'sessão' : 'sessões'} realizadas · clique num tipo para ver o que foi dito em cada sessão</div>
        </>
      )}
    </div>
  )
}

/** Só os dois rankings do mês (vendas novas e upsell/renovação), para o Painel: uma linha por consultor, sem rolar para o lado. */
function LinhaRanking({ i, tem, nome, destaque, itens }) {
  return (
    <div className={'rk-linha' + (i === 0 && tem ? ' lider' : '')}>
      <div className="rk-topo">
        <span className="rk-med">{medalha(i, tem)}</span>
        <b className="rk-nome">{nome}</b>
        <span className="rk-destaque">{destaque}</span>
      </div>
      <div className="rk-itens">
        {itens.map(([rot, val]) => <div key={rot}><span>{rot}</span><b>{val}</b></div>)}
      </div>
    </div>
  )
}

export function RankingVendas() {
  const [d, setD] = useState(null)
  useEffect(() => {
    let vivo = true
    const carregar = () => invokeFn('metas-vendas', { body: {} }).then(({ data, error }) => { if (vivo && !error && data && !data.error) setD(data) })
    carregar()
    const iv = setInterval(carregar, 120_000)
    return () => { vivo = false; clearInterval(iv) }
  }, [])
  if (!d) return <div className="card muted small">Carregando o ranking…</div>
  const nomeMes = d.mes_ini ? NOMES_MES[Number(d.mes_ini.slice(5, 7)) - 1] : ''
  const pct = (n) => String(n).replace('.', ',') + '%'
  const novas = [...(d.ranking || [])].map(convSessoes).sort(ordemRanking)
  const ups = d.ranking_upsell || []
  return (
    <div className="rk">
      <div className="rk-bloco">
        <h2>🏅 Vendas novas</h2>
        <div className="rk-resumo">{nomeMes} · {d.mes.vendas} {d.mes.vendas === 1 ? 'venda' : 'vendas'} · {fmtMoney(d.mes.valor)} em contratos · {fmtMoney(d.mes.cash || 0)} de cash</div>
        {novas.map((p, i) => (
          <LinhaRanking key={p.nome} i={i} tem={p.vendas > 0} nome={p.nome} destaque={`${p.vendas} ${p.vendas === 1 ? 'venda' : 'vendas'}`}
            itens={[['Contrato', fmtMoney(p.valor)], ['Cash', fmtMoney(p.cash || 0)], ['Conversão', pct(p.conversao)]]} />
        ))}
      </div>
      <div className="rk-bloco">
        <h2>🔁 Upgrade, upsell e renovação</h2>
        <div className="rk-resumo">{nomeMes} · {d.mes.upsells || 0} · {fmtMoney(d.mes.valor_upsell || 0)} em contratos · {fmtMoney(d.mes.cash_upsell || 0)} de cash</div>
        {ups.map((p, i) => (
          <LinhaRanking key={p.nome} i={i} tem={p.valor + (p.cash || 0) > 0} nome={p.nome} destaque={`${p.upsells} ${p.upsells === 1 ? 'venda' : 'vendas'}`}
            itens={[['Contrato', fmtMoney(p.valor)], ['Cash', fmtMoney(p.cash || 0)]]} />
        ))}
      </div>
    </div>
  )
}

/** Metas da semana (leads, sessões agendadas e realizadas), vendas do mês e ranking dos consultores. */
const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export default function MetasVendas({ atualizar, mes: mesSel, onMes, onDados }) {
  const chaveMes = mesSel ? `${mesSel.y}-${String(mesSel.m + 1).padStart(2, '0')}` : null
  const [d, setD] = useState(null)
  // recolher os indicadores para usar só o funil (fica lembrado neste navegador)
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem('indicadoresRecolhidos') === '1' } catch { return false } })
  const alternar = () => setRecolhido((v) => { try { localStorage.setItem('indicadoresRecolhidos', v ? '0' : '1') } catch { /* sem armazenamento */ } return !v })
  useEffect(() => {
    let vivo = true
    const carregar = () => invokeFn('metas-vendas', { body: chaveMes ? { mes: chaveMes } : {} }).then(({ data, error }) => { if (vivo && !error && data && !data.error) { setD(data); onDados?.(data) } })
    carregar()
    const iv = setInterval(carregar, 120_000) // registros novos de sessão entram sozinhos
    return () => { vivo = false; clearInterval(iv) }
  }, [atualizar, chaveMes])
  if (!d) return null
  // servidor ainda sem suporte ao mês escolhido: não mostra números de outro mês com o nome errado
  if (chaveMes && (d.mes_ref || d.mes_ini?.slice(0, 7)) !== chaveMes) return null
  const ini = d.semana_ini ? `${d.semana_ini.slice(8, 10)}/${d.semana_ini.slice(5, 7)}` : ''
  const M = d.metas ? { leadsSemana: d.metas.leads, agendadasSemana: d.metas.agendadas, realizadasSemana: d.metas.realizadas, vendasMes: d.metas.vendas_mes } : META
  const mm = d.metas?.mes, fm = d.metas?.feito_mes
  const fechado = d.atual === false // mês que já terminou: mostra o resultado do mês inteiro contra a meta do mês
  const nomeMes = d.mes_ini ? NOMES_MES[Number(d.mes_ini.slice(5, 7)) - 1] : ''
  const tudoOk = d.leads >= M.leadsSemana && d.agendadas >= M.agendadasSemana && d.semana.realizadas >= M.realizadasSemana
  const botao = (
    <button type="button" className="mv-recolher" onClick={alternar} aria-expanded={!recolhido}>
      {recolhido ? '▾ Mostrar indicadores' : '▴ Recolher indicadores'}
    </button>
  )
  if (recolhido) {
    return (
      <div className="metas-vendas mv-fechado" role="status">
        <div className="mv-cab">
          <div className="mv-titulo">📊 Indicadores <span>{fechado ? `resultado de ${nomeMes}` : 'metas da semana'}, ranking, objeções e upsell · {d.leads} de {M.leadsSemana} leads · {d.mes.vendas} de {M.vendasMes} vendas no mês</span></div>
          {botao}
        </div>
      </div>
    )
  }
  return (
    <div className={'metas-vendas' + (tudoOk ? ' ok' : '')} role="status">
      <div className="mv-cab">
        {fechado
          ? <div className="mv-titulo">📅 Resultado de {nomeMes} <span>mês inteiro, comparado com a meta do mês</span></div>
          : <div className="mv-titulo">🎯 Metas da semana <span>desde {ini} · o que faltou nas semanas anteriores já está somado</span></div>}
        {botao}
      </div>
      <div className="mv-grid">
        <Bloco rot="Leads novos" valor={d.leads} meta={M.leadsSemana} mes={!fechado && mm && fm ? `${fm.leads} de ${mm.leads} no mês` : null} />
        <Bloco rot="Sessões agendadas" valor={d.agendadas} meta={M.agendadasSemana} mes={!fechado && mm && fm ? `${fm.agendadas} de ${mm.agendadas} no mês` : null} />
        <Bloco rot="Sessões realizadas" valor={d.semana.realizadas} meta={M.realizadasSemana} mes={!fechado && mm && fm ? `${fm.realizadas} de ${mm.realizadas} no mês` : null} />
        <Bloco rot="Vendas do mês" valor={d.mes.vendas} meta={M.vendasMes} />
      </div>
      {d.comparecimento && (
        <div className="mv-compar">
          <span>📅 <b>Taxa de comparecimento</b></span>
          {!fechado && <span>Semana: <b>{d.comparecimento.semana.pct == null ? '—' : String(d.comparecimento.semana.pct).replace('.', ',') + '%'}</b> ({d.comparecimento.semana.show} vieram · {d.comparecimento.semana.noshow} no-show)</span>}
          <span>Mês: <b>{d.comparecimento.mes.pct == null ? '—' : String(d.comparecimento.mes.pct).replace('.', ',') + '%'}</b> ({d.comparecimento.mes.show} vieram · {d.comparecimento.mes.noshow} no-show)</span>
        </div>
      )}
      {d.ranking?.length > 0 && (
        <div className="mv-ranking">
          <div className="mv-titulo">🏅 Ranking de vendas novas <span>do mês, pelo Registro de Sessões 1:1</span></div>
          <div className="mv-tabela">
            <table>
              <thead><tr><th>#</th><th>Consultor</th><th>Vendas</th><th>Valor do contrato</th><th title="Pix na hora + cartão por link (entra no dia seguinte, já sem a taxa da InfinitePay)">Cash collect</th><th>Sessões realizadas</th><th>No-show</th><th>Conversão</th></tr></thead>
              <tbody>
                {[...d.ranking].map(convSessoes).sort(ordemRanking).map((p, i) => (
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
          <PlacarVendas tipo="upsell" atualizar={atualizar} mes={mesSel} onMes={onMes} />
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
