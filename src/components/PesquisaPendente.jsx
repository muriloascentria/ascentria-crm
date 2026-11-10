import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'

export const TITULO_PESQUISA = 'Pesquisa do Murilo enviada'
const ESPERA_MIN = 90 // minutos depois do início da reunião
const JANELA_DIAS = 3 // até quantos dias depois ainda lembra
const FORA = /n[aã]o compareceu|remarcar|desqualificad|comprou e cancelou/i

/**
 * Aviso AZUL (em todas as telas, só para a gestão) quando chega a hora de o Murilo mandar
 * a pesquisa pós-reunião (🤓). Some quando a pesquisa é enviada pelo card ou ao clicar em "Já enviei".
 */
export default function PesquisaPendente() {
  const { profile, isManager } = useApp()
  const navigate = useNavigate()
  const [itens, setItens] = useState([])
  const chave = `pesquisaPulada:${profile?.id}`
  const [pulados, setPulados] = useState(() => { try { return JSON.parse(localStorage.getItem(chave) || '[]') } catch { return [] } })

  const load = useCallback(async () => {
    if (!isManager) return
    const desde = new Date(Date.now() - (JANELA_DIAS + 1) * 86_400_000).toISOString().slice(0, 10)
    const { data } = await supabase.from('deals')
      .select('id, title, meeting_date, meeting_time, relatorio_texto, relatorio_enviado_em, stage:stages(name), contact:contacts(name), seller:calendar_sellers(name)')
      .gte('meeting_date', desde)
      .not('meeting_time', 'is', null)
    const agora = Date.now()
    const cand = (data || []).map((d) => ({ ...d, ini: new Date(`${d.meeting_date}T${String(d.meeting_time).slice(0, 5)}:00-03:00`).getTime() }))
      .filter((d) => !/teste/i.test(d.title || '') && !/teste/i.test(d.contact?.name || ''))
      .filter((d) => !FORA.test(d.stage?.name || ''))
      .filter((d) => agora >= d.ini + ESPERA_MIN * 60_000 && agora <= d.ini + JANELA_DIAS * 86_400_000)
    if (!cand.length) { setItens([]); return }
    const { data: feitas } = await supabase.from('activities').select('deal_id').eq('title', TITULO_PESQUISA).in('deal_id', cand.map((d) => d.id))
    const ja = new Set((feitas || []).map((a) => a.deal_id))
    // sem pesquisa de satisfação (10/11/2026): o aviso é só do relatório e some quando ele é enviado
    setItens(cand.filter((d) => !ja.has(d.id) && !d.relatorio_enviado_em).sort((a, b) => a.ini - b.ini))
  }, [isManager])

  useEffect(() => {
    load()
    const iv = setInterval(load, 60_000)
    const onFeita = () => load()
    window.addEventListener('pesquisa-enviada', onFeita)
    return () => { clearInterval(iv); window.removeEventListener('pesquisa-enviada', onFeita) }
  }, [load])

  const pendentes = itens.filter((d) => !pulados.includes(d.id))

  const jaEnviei = async (d) => {
    setItens((l) => l.filter((x) => x.id !== d.id))
    await supabase.from('activities').insert({ type: 'whatsapp', title: TITULO_PESQUISA, deal_id: d.id, done: true, done_at: new Date().toISOString() })
  }
  const pular = (d) => {
    const n = [...new Set([...pulados, d.id])].slice(-300)
    setPulados(n)
    try { localStorage.setItem(chave, JSON.stringify(n)) } catch { /* sem armazenamento */ }
  }

  if (!isManager || !pendentes.length) return null
  const quando = (ms) => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="alert-pesquisa" role="alert">
      <div className="alert-pesquisa-titulo">🤓 {pendentes.length === 1 ? 'Hora de enviar o relatório' : `${pendentes.length} leads esperando o relatório`}</div>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        {pendentes.map((d) => (
          <div key={d.id} className="alert-pesquisa-item">
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{d.contact?.name || d.title}</b>
              {d.seller?.name && <> · reunião com <b>{d.seller.name}</b></>}
              <span> · {quando(d.ini)}</span>
              {d.stage?.name && <span> · {d.stage.name}</span>}
              <span> · {d.relatorio_texto ? '📄 relatório pronto para enviar' : '⏳ relatório ainda sendo gerado'}</span>
            </div>
            <button type="button" className="btn sm alert-pesquisa-btn" onClick={() => navigate(`/funil?negocio=${d.id}`)}>Abrir card</button>
            <button type="button" className="btn sm" onClick={() => jaEnviei(d)}>✓ Já enviei</button>
            <button type="button" className="btn ghost sm" onClick={() => pular(d)} title="Não vou enviar para este lead">Pular</button>
          </div>
        ))}
      </div>
    </div>
  )
}
