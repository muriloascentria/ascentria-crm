import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtMoney, fmtDate } from '../lib/utils'
import { Avatar, Empty } from '../components/ui'
import DealModal from '../components/DealModal'
import { daysIn, runCadenceNow, simulateInstagramDM, moveInboxToDay1, sentLast24h } from '../lib/wa'
import { DEMO } from '../lib/supabase'

/**
 * Rodinha do mouse rola o quadro na horizontal, com animação suave.
 * Sobre a lista de cards de uma coluna que ainda tem conteúdo para rolar na vertical,
 * a rodinha continua rolando a coluna (comportamento normal).
 */
function useWheelToHorizontal() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let target = el.scrollLeft
    let raf = 0
    const animate = () => {
      const diff = target - el.scrollLeft
      if (Math.abs(diff) < 0.5) { el.scrollLeft = target; raf = 0; return }
      el.scrollLeft += diff * 0.18
      raf = requestAnimationFrame(animate)
    }
    const onWheel = (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // zoom ou trackpad já horizontal
      const body = e.target.closest?.('.col-body')
      if (body && body.scrollHeight > body.clientHeight) {
        const canDown = body.scrollTop + body.clientHeight < body.scrollHeight - 1
        const canUp = body.scrollTop > 0
        if ((e.deltaY > 0 && canDown) || (e.deltaY < 0 && canUp)) return
      }
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      e.preventDefault()
      const step = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY
      if (!raf) target = el.scrollLeft
      target = Math.max(0, Math.min(max, target + step * 1.2))
      if (!raf) raf = requestAnimationFrame(animate)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel); if (raf) cancelAnimationFrame(raf) }
  })
  return ref
}

const isUnread = (d) => !!d.last_inbound_at && (!d.seen_at || new Date(d.last_inbound_at) > new Date(d.seen_at))

export default function Pipeline() {
  const { pipelines, stages, users, settings, toast, label, profile, isManager } = useApp()
  const boardRef = useWheelToHorizontal()
  const [pipelineId, setPipelineId] = useState(null)
  const [deals, setDeals] = useState([])
  const [q, setQ] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [modal, setModal] = useState(null) // { deal, defaults }
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null)
  const [sent24, setSent24] = useState(null)
  // lembretes do encontro que não saíram sozinhos (viraram tarefa) e ainda não foram feitos
  const [pendLembretes, setPendLembretes] = useState([])
  // contratos assinados nos últimos 3 dias (de qualquer funil), para o aviso verde no topo
  const [assinados, setAssinados] = useState([])
  const chaveVistos = `contratosVistos:${profile.id}`
  const [vistos, setVistos] = useState(() => { try { return JSON.parse(localStorage.getItem(chaveVistos) || '[]') } catch { return [] } })
  const marcarVisto = (id) => {
    const novo = [...new Set([...vistos, id])].slice(-200)
    setVistos(novo)
    try { localStorage.setItem(chaveVistos, JSON.stringify(novo)) } catch { /* sem armazenamento: o aviso some só nesta sessão */ }
  }

  useEffect(() => { if (!pipelineId && pipelines.length) setPipelineId(pipelines.find((p) => p.is_default)?.id || pipelines[0].id) }, [pipelines, pipelineId])

  const load = useCallback(async () => {
    if (!pipelineId) return
    const { data, error } = await supabase.from('deals')
      .select('*, contact:contacts(name)')
      .eq('pipeline_id', pipelineId).order('position').order('created_at', { ascending: false })
    if (error) toast(error.message, 'err')
    setDeals(data || [])
    const { data: acts } = await supabase.from('activities').select('id, deal_id, title, created_at')
      .eq('done', false).like('title', 'Enviar lembrete à mão%').gte('created_at', new Date(Date.now() - 2 * 86_400_000).toISOString())
    setPendLembretes(acts || [])
    const { data: ass } = await supabase.from('deals').select('*, contact:contacts(name), seller:calendar_sellers(name, email)')
      .eq('contrato_status', 'assinado').gte('contrato_assinado_em', new Date(Date.now() - 3 * 86_400_000).toISOString())
      .order('contrato_assinado_em', { ascending: false })
    setAssinados(ass || [])
  }, [pipelineId, toast])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const iv = setInterval(() => { if (document.visibilityState === 'visible' && !dragId && !modal) load() }, 30_000)
    return () => clearInterval(iv)
  }, [load, dragId, modal])
  const openDeal = (d) => {
    setModal({ deal: d })
    if (isUnread(d)) {
      const seen = new Date().toISOString()
      setDeals((all) => all.map((x) => (x.id === d.id ? { ...x, seen_at: seen } : x)))
      supabase.from('deals').update({ seen_at: seen }).eq('id', d.id).then(() => window.dispatchEvent(new Event('crm:unread')))
    }
  }

  const pipeStages = stages.filter((s) => s.pipeline_id === pipelineId)
  const pipe = pipelines.find((p) => p.id === pipelineId)
  const hasCadence = pipeStages.some((s) => s.role)
  useEffect(() => { if (hasCadence) sentLast24h().then(setSent24) }, [hasCadence, deals])
  const bulkMove = async () => {
    const inboxCount = deals.filter((d) => d.stage_id === pipeStages.find((s) => s.role === 'inbox')?.id).length
    // Cada lead recebe 1 modelo por dia em todos os Dias da sequência; por isso a cota diária de NOVOS
    // é o limite da Meta dividido pelo número de Dias (250 ÷ 5 = 50), menos quem já entrou no Dia 1 nas últimas 24h.
    const limit = pipe?.daily_limit ?? 250
    const dayStages = pipeStages.filter((s) => s.role === 'day')
    const perDay = Math.floor(limit / Math.max(1, dayStages.length))
    const day1 = dayStages.slice().sort((a, b) => a.position - b.position)[0]
    const enteredToday = deals.filter((d) => d.stage_id === day1?.id && Date.now() - new Date(d.stage_entered_at).getTime() < 86_400_000).length
    const suggested = Math.max(0, Math.min(inboxCount, perDay - enteredToday))
    const v = window.prompt(`Quantos leads mover de "Recebidos" para o Dia 1? (mais antigos primeiro)\n\nCota segura de novos por dia: ${perDay} (limite da Meta ${limit} ÷ ${dayStages.length} dias da sequência).\nJá entraram no Dia 1 nas últimas 24h: ${enteredToday} · Disponíveis em Recebidos: ${inboxCount}`, String(suggested))
    if (v === null) return
    const n = Number(v); if (!n || n < 1) return
    try { const moved = await moveInboxToDay1(pipelineId, n); toast(`${moved} lead(s) movido(s) para o Dia 1`); load() } catch (e) { toast(e.message, 'err') }
  }
  const filtered = useMemo(() => deals.filter((d) =>
    (!onlyMine || d.owner_id === profile.id) &&
    (!q || (d.title + ' ' + (d.contact?.name || '')).toLowerCase().includes(q.toLowerCase()))
  ), [deals, q, onlyMine, profile.id])

  const moveTo = async (dealId, stageId) => {
    const d = deals.find((x) => x.id === dealId)
    if (!d || d.stage_id === stageId) return
    setDeals((ds) => ds.map((x) => (x.id === dealId ? { ...x, stage_id: stageId } : x)))
    const { error } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', dealId)
    if (error) { toast(error.message, 'err'); load() } else load()
  }

  const userName = (id) => users.find((u) => u.id === id)?.full_name || ''
  // some sozinho quando a tarefa é concluída ou 1h depois do horário do encontro
  const encontroAindaVale = (d) => !d.meeting_date || !d.meeting_time || new Date(`${d.meeting_date}T${String(d.meeting_time).slice(0, 5)}:00-03:00`).getTime() > Date.now() - 3_600_000
  const lembretePend = (d) => encontroAindaVale(d) && pendLembretes.some((a) => a.deal_id === d.id)
  const dealsComLembrete = deals.filter(lembretePend)
  // aviso de contrato assinado: para a vendedora do encontro, para quem é dona do card e para a gestão
  const meuEmail = String(profile.email || '').toLowerCase()
  const contratosNovos = assinados.filter((d) => !vistos.includes(d.id) &&
    (isManager || d.owner_id === profile.id || String(d.seller?.email || '').toLowerCase() === meuEmail))
  const totalOpen = filtered.filter((d) => d.status === 'open').reduce((s, d) => s + Number(d.value), 0)

  return (
    <>
      <div className="page-head">
        <div className="row wrap">
          <h1>{label('pipeline')}</h1>
          {pipelines.length > 1 && (
            <select className="select" style={{ width: 'auto' }} value={pipelineId || ''} onChange={(e) => setPipelineId(e.target.value)}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <span className="chip">Em aberto: <b>{fmtMoney(totalOpen, settings.currency)}</b></span>
        </div>
        <div className="row wrap">
          <input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <label className="check small"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Só meus</label>
          {DEMO && pipeStages.some((s) => s.role) && <button className="btn" title="Simula uma mensagem no direct do Instagram contendo um celular" onClick={async () => { const r = await simulateInstagramDM(); toast(`DM recebida: ${r.name} entrou em Recebidos`); load() }}>📷 Simular DM do Instagram</button>}
          {DEMO && pipeStages.some((s) => s.role) && <button className="btn" title="Simula a passagem de 1 dia e roda o motor da cadência" onClick={async () => { const r = await runCadenceNow(); toast(`+1 dia: ${r.cadence.advanced} avançou, ${r.cadence.archived} perdido cadência, ${r.cadence.reactivated} reativado`); load() }}>⏩ Simular +1 dia</button>}
          <button className="btn primary" onClick={() => setModal({ deal: null, defaults: { pipeline_id: pipelineId } })}>+ Negócio</button>
        </div>
      </div>
      {dealsComLembrete.length > 0 && (
        <div className="alert-lembrete" role="alert">
          <b>⚠ {dealsComLembrete.length === 1 ? 'Um lembrete de encontro não saiu sozinho' : `${dealsComLembrete.length} lembretes de encontro não saíram sozinhos`}</b> (janela de 24h do WhatsApp fechada). Abra o card e envie à mão, o texto pronto está em Atividades:
          <span className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {dealsComLembrete.map((d) => (
              <button key={d.id} type="button" className="btn sm" onClick={() => openDeal(d)}>
                {d.contact?.name || d.title}{d.meeting_time ? ` · ${d.meeting_date ? fmtDate(d.meeting_date).slice(0, 5) + ' ' : ''}${String(d.meeting_time).slice(0, 5)}` : ''}
              </button>
            ))}
          </span>
        </div>
      )}

      {contratosNovos.length > 0 && (
        <div className="alert-contrato" role="status">
          <b>✅ {contratosNovos.length === 1 ? 'Contrato assinado' : `${contratosNovos.length} contratos assinados`}</b> — o Murilo e o lead já assinaram:
          <span className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {contratosNovos.map((d) => (
              <span key={d.id} className="row" style={{ gap: 2 }}>
                <button type="button" className="btn sm" onClick={() => openDeal(d)}>
                  {d.contact?.name || d.title}{d.seller?.name ? ` · ${d.seller.name}` : ''}{d.contrato_assinado_em ? ` · ${fmtDate(d.contrato_assinado_em).slice(0, 5)}` : ''}
                </button>
                <button type="button" className="btn ghost sm" title="Já vi — tirar o aviso" onClick={() => marcarVisto(d.id)}>✕</button>
              </span>
            ))}
          </span>
        </div>
      )}

      {pipeStages.length === 0 ? <Empty title="Nenhuma etapa" text="Configure as etapas deste funil em Configurações → Funis." /> : (
        <div className="kanban" ref={boardRef}>
          {pipeStages.map((s) => {
            // Ordem: respostas não lidas primeiro; depois quem respondeu por último no topo; quem nunca respondeu fica abaixo.
            const items = filtered.filter((d) => d.stage_id === s.id).sort((a, b) => (Number(isUnread(b)) - Number(isUnread(a))) || ((b.last_inbound_at ? Date.parse(b.last_inbound_at) : 0) - (a.last_inbound_at ? Date.parse(a.last_inbound_at) : 0)))
            const unreadN = items.filter(isUnread).length
            const sum = items.reduce((a, d) => a + Number(d.value), 0)
            return (
              <div key={s.id} className={'col' + (over === s.id ? ' over' : '')}
                onDragOver={(e) => { e.preventDefault(); if (over !== s.id) setOver(s.id) }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); moveTo(dragId, s.id); setDragId(null) }}>
                <div className="col-head" style={{ '--stage-color': s.color }}>
                  <div className="name"><span>{s.name}{unreadN > 0 && <span className="unread-pill" title="respostas não lidas">{unreadN} {unreadN === 1 ? 'nova' : 'novas'}</span>}</span><span className="muted">{items.length}</span></div>
                  <div className="small muted">{fmtMoney(sum, settings.currency)} · {s.probability}%{s.role === 'day' && s.advance_after_days ? ` · ${s.advance_after_days}d` : ''}</div>
                  {s.role && <div className="role-chip">{{ inbox: 'entrada automática · mover manualmente', day: s.auto_send ? 'envio automático' : 'mensagem manual', responsive: 'respondeu · volta à sequência após 24h parado', archived: 'volta ao Dia 1 em 4 meses', reactivate: 'chamar de novo' }[s.role]}</div>}
                  {s.role === 'inbox' && items.length > 0 && <button className="btn sm" style={{ marginTop: 4, justifyContent: 'center' }} onClick={bulkMove}>Mover em lote para o Dia 1 →</button>}
                  {s.role === 'day' && s.id === pipeStages.find((x) => x.role === 'day')?.id && sent24 !== null && (
                    <div className="small" style={{ marginTop: 2, color: sent24 >= (pipe?.daily_limit ?? 250) ? 'var(--danger)' : 'var(--muted)' }} title="Conversas iniciadas pela empresa (templates) nas últimas 24h × limite da Meta">últimas 24h: <b>{sent24}</b> / {pipe?.daily_limit ?? 250} envios</div>
                  )}
                </div>
                <div className="col-body">
                  {items.map((d) => {
                    const overdue = d.status === 'open' && d.expected_close && new Date(d.expected_close) < new Date(new Date().toDateString())
                    return (
                      <div key={d.id} className={'deal' + (dragId === d.id ? ' dragging' : '') + (overdue ? ' overdue' : '') + (isUnread(d) ? ' unread' : '')} draggable
                        onDragStart={() => setDragId(d.id)} onDragEnd={() => { setDragId(null); setOver(null) }}
                        onClick={() => openDeal(d)}>
                        {isUnread(d) && <span className="unread-dot" title="Nova mensagem do lead" aria-label="Nova mensagem" />}
                        <div className="title">{d.title}</div>
                        {d.contrato_status === 'assinado' && <div className="tag-contrato ok" title="Contrato assinado pelo Murilo e pelo lead">✅ Contrato assinado</div>}
                        {d.contrato_status === 'enviado' && <div className="tag-contrato" title="Contrato enviado para assinatura (Autentique)">📨 Contrato enviado</div>}
                        {d.contrato_status === 'recusado' && <div className="tag-contrato no" title="O contrato foi recusado na Autentique">⛔ Contrato recusado</div>}
                        {lembretePend(d) && <div className="tag-lembrete" title="O lembrete do encontro não saiu sozinho: envie à mão (texto pronto em Atividades, dentro do card)">⚠ lembrete não enviado</div>}
                        <div className="small muted">{d.contact?.name || '—'}</div>
                        <div className="between" style={{ marginTop: 6 }}>
                          <span className="val">{fmtMoney(d.value, settings.currency)}</span>
                          <span className="row small muted">{s.role ? <span title="dias nesta coluna">{daysIn(d.stage_entered_at)}d</span> : d.expected_close && <span>{fmtDate(d.expected_close)}</span>}<Avatar sm name={userName(d.owner_id)} src={users.find((u) => u.id === d.owner_id)?.avatar_url} /></span>
                        </div>
                      </div>
                    )
                  })}
                  <button className="btn ghost sm" style={{ justifyContent: 'center', color: 'var(--muted)' }} onClick={() => setModal({ deal: null, defaults: { pipeline_id: pipelineId, stage_id: s.id } })}>+ adicionar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && <DealModal deal={modal.deal} defaults={modal.defaults} onClose={async () => { const id = modal.deal?.id; setModal(null); if (id) { await supabase.from('deals').update({ seen_at: new Date().toISOString() }).eq('id', id); window.dispatchEvent(new Event('crm:unread')) } load() }} onSaved={load}
        onMarkUnread={async () => {
          const id = modal.deal?.id
          setModal(null)
          const { error } = await supabase.from('deals').update({ seen_at: null }).eq('id', id)
          if (error) toast(error.message, 'err'); else toast('Marcado como não lido')
          window.dispatchEvent(new Event('crm:unread')); load()
        }} />}
    </>
  )
}
