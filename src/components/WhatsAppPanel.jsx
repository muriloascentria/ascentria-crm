import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { inWindow, sendWhatsApp, getMedia, MEDIA_TYPES, QUICK_STAGES, SITUATIONAL_STAGES, quickStageLabel, splitParts, pendingFields, fillMeeting, meetingDateLabel, meetingTimeLabel } from '../lib/wa'
import { fmtDateTime } from '../lib/utils'
import { Field } from './ui'
import { callCalendar, fillSlots, slotLabel } from '../lib/calendar'

/** Conversa de WhatsApp de um contato (com envio). deal opcional para vincular e calcular a janela de 24h. */
export default function WhatsAppPanel({ contactId, deal, onSent, onStageChanged, header, stageId }) {
  const { toast, settings, waNumbers, sellers, stages } = useApp()
  const via = waNumbers.find((n) => n.id === deal?.wa_number_id) || waNumbers.find((n) => n.is_default) || waNumbers[0]
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [mode, setMode] = useState('text')
  const [tpl, setTpl] = useState({ name: '', params: '' })
  const [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState([])
  const [showQuick, setShowQuick] = useState(false)
  const [question, setQuestion] = useState({ body: '', options: [] })
  // Sequência: várias mensagens de uma mensagem pronta, enviadas em ordem. As opções vão na última.
  const [seq, setSeq] = useState({ parts: [], options: [] })
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState('')
  // Quais mensagens prontas já foram para este contato (✓) e qual foi escolhida agora.
  const [sends, setSends] = useState([])
  const [pickedId, setPickedId] = useState(null)
  const loadSends = useCallback(() => supabase.from('quick_reply_sends').select('*').eq('contact_id', contactId).then(({ data }) => setSends(data || [])), [contactId])
  useEffect(() => { loadSends() }, [loadSends])
  // Encontro confirmado (dia, hora e link): preenche [DATA], [HORA], [HOJE OU AMANHÃ] e [LINK] sozinho.
  const [meeting, setMeeting] = useState({ date: '', time: '', link: '' })
  const curStageRef = useRef(deal?.stage_id)
  useEffect(() => {
    setMeeting({ date: deal?.meeting_date || '', time: (deal?.meeting_time || '').slice(0, 5), link: deal?.meeting_link || '' })
  }, [deal?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Agenda Google: horários livres da vendedora → [DIA 1]/[HORA 1] e [DIA 2]/[HORA 2]; reserva com Meet.
  const [sellerId, setSellerId] = useState('')
  const [found, setFound] = useState(null)
  const [offered, setOffered] = useState([])
  const [booked, setBooked] = useState(null)
  const [calBusy, setCalBusy] = useState('')
  const activeSellers = (sellers || []).filter((s) => s.active)
  useEffect(() => {
    setOffered(Array.isArray(deal?.offered_slots) ? deal.offered_slots : [])
    setBooked(deal?.calendar_event_id ? { eventId: deal.calendar_event_id, sellerId: deal.seller_id } : null)
    setSellerId(deal?.seller_id || '')
    setFound(null)
  }, [deal?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sellerId && activeSellers[0]) setSellerId(activeSellers[0].id) }, [activeSellers.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const sellerName = (id) => activeSellers.find((s) => s.id === id)?.name || (sellers || []).find((s) => s.id === id)?.name || ''
  const aplicarNaMensagem = (fn) => {
    setText((t) => fn(t))
    setQuestion((q) => ({ ...q, body: fn(q.body) }))
    setSeq((sq) => ({ ...sq, parts: sq.parts.map(fn) }))
  }
  const oferecer = async (lista) => {
    const ord = [...lista].sort((a, b) => (a.start < b.start ? -1 : 1)).slice(0, 2)
    setOffered(ord)
    aplicarNaMensagem((t) => fillSlots(t, ord))
    if (deal?.id) { try { await callCalendar('offer', { deal_id: deal.id, slots: ord }) } catch (e) { toast(e.message, 'err') } }
  }
  const buscarHorarios = async () => {
    if (!sellerId) return toast('Escolha a vendedora', 'err')
    setCalBusy('buscar')
    try {
      const r = await callCalendar('slots', { seller_id: sellerId })
      setFound(r.slots || [])
      if (!r.slots?.length) toast(`Nenhum horário "${settings?.slot_title || 'DISPONÍVEL PARA AGENDAMENTO'}" nos próximos 30 dias da agenda de ${r.seller}.`, 'err')
      else {
        // por padrão: o primeiro horário livre + o primeiro de OUTRO dia (a mensagem oferece dois dias diferentes)
        const [a, ...resto] = r.slots
        const b = resto.find((x) => x.date !== a.date) || resto[0]
        await oferecer(b ? [a, b] : [a])
      }
    } catch (e) { toast(e.message, 'err') } finally { setCalBusy('') }
  }
  const alternarOferta = (s) => {
    const tem = offered.some((o) => o.event_id === s.event_id)
    const nova = tem ? offered.filter((o) => o.event_id !== s.event_id) : [...offered, s].slice(-2)
    oferecer(nova)
  }
  const reservar = async (s) => {
    if (!deal?.id) return
    setCalBusy(s.event_id)
    try {
      const r = await callCalendar('book', { deal_id: deal.id, seller_id: s.seller_id, event_id: s.event_id })
      setBooked({ eventId: s.event_id, sellerId: s.seller_id })
      await saveMeeting({ date: r.date, time: r.time, link: r.link || '' })
      toast(`Reservado na agenda de ${r.seller}${r.link ? ' · Google Meet criado' : ''}`)
    } catch (e) { toast(e.message, 'err') } finally { setCalBusy('') }
  }
  const desfazerReserva = async () => {
    if (!deal?.id || !window.confirm('Desfazer a reserva? O horário volta a ficar disponível na agenda da vendedora.')) return
    setCalBusy('release')
    try {
      await callCalendar('release', { deal_id: deal.id })
      setBooked(null)
      await saveMeeting({ date: '', time: '', link: '' })
      toast('Reserva desfeita')
    } catch (e) { toast(e.message, 'err') } finally { setCalBusy('') }
  }
  // Trocar de vendedora mantendo o horário (também acha encontros marcados direto na agenda do Google)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveFrom, setMoveFrom] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const abrirTroca = () => {
    const de = booked?.sellerId || deal?.seller_id || sellerId || activeSellers[0]?.id || ''
    setMoveFrom(de)
    setMoveTo(activeSellers.find((s) => s.id !== de)?.id || '')
    setMoveOpen((v) => !v)
  }
  const trocarVendedora = async () => {
    if (!deal?.id || !moveFrom || !moveTo || moveFrom === moveTo) return toast('Escolha duas vendedoras diferentes', 'err')
    setCalBusy('transfer')
    try {
      const prev = await callCalendar('transfer', { deal_id: deal.id, from_seller_id: moveFrom, to_seller_id: moveTo, dry_run: true })
      if (!window.confirm(`Mover "${prev.event.summary}" (${prev.event.date.split('-').reverse().join('/')} às ${prev.event.time}) da agenda de ${prev.from} para a de ${prev.to}, no mesmo horário?\n\nO horário na agenda de ${prev.from} volta a ficar disponível e um novo link do Meet é criado.`)) return
      const r = await callCalendar('transfer', { deal_id: deal.id, from_seller_id: moveFrom, to_seller_id: moveTo })
      setBooked({ eventId: 'moved', sellerId: moveTo })
      setSellerId(moveTo)
      setMoveOpen(false)
      await saveMeeting({ date: r.date, time: r.time, link: r.link || '' })
      toast(`Encontro passado para a agenda de ${r.to}${r.link ? ' · novo link do Meet criado' : ''}`)
    } catch (e) { toast(e.message, 'err') } finally { setCalBusy('') }
  }
  const [curStageId, setCurStageId] = useState(deal?.stage_id)
  useEffect(() => { setCurStageId(deal?.stage_id); curStageRef.current = deal?.stage_id }, [deal?.id, deal?.stage_id])
  // etapa trocada no cabeçalho do card (fora deste painel)
  useEffect(() => { if (stageId) { setCurStageId(stageId); curStageRef.current = stageId } }, [stageId])
  const remarcarStage = stages.find((s) => s.pipeline_id === deal?.pipeline_id && /remarc/i.test(s.name))
  const naReuniao = /reuni/i.test(stages.find((s) => s.id === curStageId)?.name || '')
  const podeCancelar = !!deal?.id && !!remarcarStage && curStageId !== remarcarStage.id && (naReuniao || !!booked || !!meeting.date)
  const leadCancelou = async () => {
    if (!window.confirm('O lead cancelou? O card vai para "Remarcar", o horário é liberado na agenda da vendedora e a pergunta de remarcação fica pronta para enviar.')) return
    setCalBusy('cancel')
    try {
      if (booked) await callCalendar('release', { deal_id: deal.id })
      const { error } = await supabase.from('deals').update({ stage_id: remarcarStage.id, meeting_date: null, meeting_time: null, meeting_link: null, calendar_event_id: null, offered_slots: [] }).eq('id', deal.id)
      if (error) throw error
      setBooked(null); setOffered([]); setFound(null)
      setMeeting({ date: '', time: '', link: '' })
      setCurStageId(remarcarStage.id); curStageRef.current = remarcarStage.id
      onStageChanged?.(remarcarStage.id)
      const pergunta = [...quick].filter((q) => q.stage === 'remarcacao').sort((a, b) => a.position - b.position)[0]
      if (pergunta) pick(pergunta)
      toast(win ? 'Card movido para Remarcar. A pergunta de remarcação está pronta: confira e clique em Enviar.' : 'Card movido para Remarcar. Atenção: fora da janela de 24h só é possível enviar template.')
      onSent?.()
    } catch (e) { toast(e.message, 'err') } finally { setCalBusy('') }
  }
  const [firstName, setFirstName] = useState('')
  const win = inWindow(deal)

  const load = useCallback(async () => {
    const { data } = await supabase.from('wa_messages').select('*').eq('contact_id', contactId).order('created_at')
    setMsgs(data || [])
  }, [contactId])
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])
  useEffect(() => {
    supabase.from('quick_replies').select('*').order('position').then(({ data }) => setQuick(data || []))
    supabase.from('contacts').select('name').eq('id', contactId).single().then(({ data }) => setFirstName((data?.name || '').split(' ')[0]))
  }, [contactId])
  const fill = (t = '') => fillSlots(fillMeeting(t.replace(/{{primeiro_nome}}/g, firstName).replace(/{{nome}}/g, firstName), meeting), offered)
  const pick = (q) => {
    setShowQuick(false)
    setPickedId(q.id)
    const parts = splitParts(q.body)
    if (parts.length > 1) { setSeq({ parts: parts.map(fill), options: [...(q.options || [])] }); setMode('sequence'); return }
    if (q.options?.length) { setQuestion({ body: fill(q.body), options: [...q.options] }); setMode('interactive') }
    else { setText(fill(q.body)); setMode('text') }
  }
  const saveMeeting = async (patch) => {
    const novo = { ...meeting, ...patch }
    setMeeting(novo)
    // O que já estiver escrito na caixa de mensagem também recebe o dia e a hora na mesma hora.
    setText((t) => fillMeeting(t, novo))
    setQuestion((q) => ({ ...q, body: fillMeeting(q.body, novo) }))
    setSeq((sq) => ({ ...sq, parts: sq.parts.map((x) => fillMeeting(x, novo)) }))
    if (!deal?.id) return
    const { error } = await supabase.from('deals').update({ meeting_date: novo.date || null, meeting_time: novo.time || null, meeting_link: novo.link.trim() || null }).eq('id', deal.id)
    if (error) return toast(error.message, 'err')
    // Encontro marcado (dia e hora preenchidos): o card vai sozinho para "Reunião agendada".
    const reuniao = stages.find((s) => s.pipeline_id === deal.pipeline_id && /reuni/i.test(s.name))
    const atual = stages.find((s) => s.id === curStageRef.current)
    if (novo.date && novo.time && reuniao && atual && atual.id !== reuniao.id && atual.kind === 'open') {
      const { error: e2 } = await supabase.from('deals').update({ stage_id: reuniao.id }).eq('id', deal.id)
      if (e2) return toast(e2.message, 'err')
      curStageRef.current = reuniao.id
      setCurStageId(reuniao.id)
      onStageChanged?.(reuniao.id)
      toast('Card movido para Reunião agendada')
      onSent?.()
    }
  }
  const quickVisiveis = quick.filter((q) => !stage || (stage === 'outras' ? !q.stage : q.stage === stage))
  const enviadaEm = (q) => { const f = sends.filter((x) => x.quick_reply_id === q.id).map((x) => x.sent_at).sort(); return f.length ? f[f.length - 1] : null }
  const ORDEM_ETAPA = { agendamento: 1, qualificacao: 2, confirmacao: 3 }
  const sequencia = quick.filter((q) => !SITUATIONAL_STAGES.includes(q.stage)).sort((a, b) => (ORDEM_ETAPA[a.stage] || 9) - (ORDEM_ETAPA[b.stage] || 9) || a.position - b.position)
  const proxima = sequencia.find((q) => !enviadaEm(q))
  const totalEnviadas = sequencia.filter((q) => enviadaEm(q)).length
  const abrirMensagens = () => {
    // Ao abrir, a lista já vai para a etapa da próxima mensagem.
    // Card na coluna "Remarcar": abre direto nas mensagens de Remarcação.
    const naRemarcar = /remarc/i.test(stages.find((s) => s.id === deal?.stage_id)?.name || '')
    if (!showQuick && naRemarcar) setStage('remarcacao')
    else if (!showQuick && proxima?.stage) setStage(proxima.stage)
    setShowQuick((v) => !v)
  }
  // Rola só a caixa da conversa (nunca a janela inteira), e só se a pessoa já estava vendo o fim:
  // assim a tela não "pula" quando chega mensagem nova enquanto ela escreve ou escolhe outra mensagem.
  const chatRef = useRef(null)
  const stickRef = useRef(true)
  const onChatScroll = () => { const c = chatRef.current; if (c) stickRef.current = c.scrollHeight - c.scrollTop - c.clientHeight < 60 }
  useEffect(() => { const c = chatRef.current; if (c && stickRef.current) c.scrollTop = c.scrollHeight }, [msgs.length])
  useEffect(() => { setMode(win ? 'text' : 'template') }, [win])

  const registrarEnvio = async () => {
    if (!pickedId) return
    const id = pickedId
    setPickedId(null)
    await supabase.from('quick_reply_sends').insert({ contact_id: contactId, quick_reply_id: id, deal_id: deal?.id || null })
    loadSends()
  }
  // Marcar/desmarcar à mão (por exemplo, quando a mensagem foi mandada pelo celular).
  const toggleSent = async (q) => {
    const feitos = sends.filter((x) => x.quick_reply_id === q.id)
    if (feitos.length) await supabase.from('quick_reply_sends').delete().eq('contact_id', contactId).eq('quick_reply_id', q.id)
    else await supabase.from('quick_reply_sends').insert({ contact_id: contactId, quick_reply_id: q.id, deal_id: deal?.id || null })
    loadSends()
  }
  const send = async (e) => {
    e.preventDefault()
    const escrito = mode === 'text' ? text : mode === 'interactive' ? question.body : mode === 'sequence' ? seq.parts.join('\n') : ''
    const faltam = pendingFields(escrito)
    if (faltam.length) return toast(`Preencha antes de enviar: ${faltam.join(', ')}`, 'err')
    setBusy(true)
    let parouEm = ''
    try {
      const base = { contact_id: contactId, deal_id: deal?.id, wa_number_id: deal?.wa_number_id || undefined }
      if (mode === 'sequence') {
        const parts = seq.parts.map((t) => t.trim()).filter(Boolean)
        const opts = seq.options.filter((o) => o.trim())
        for (let i = 0; i < parts.length; i++) {
          parouEm = `${i + 1} de ${parts.length}`
          setProgress(`${i + 1}/${parts.length}`)
          const last = i === parts.length - 1
          await sendWhatsApp(last && opts.length ? { ...base, kind: 'interactive', body: parts[i], options: opts } : { ...base, kind: 'text', body: parts[i] })
          // Uma pequena pausa para as mensagens chegarem na ordem certa no celular do lead.
          if (!last) await new Promise((r) => setTimeout(r, 1200))
        }
        await registrarEnvio()
        setSeq({ parts: [], options: [] }); setMode('text'); setProgress('')
        toast(`${parts.length} mensagens enviadas`); load(); onSent?.()
        return
      }
      await sendWhatsApp(mode === 'text' ? { ...base, kind: 'text', body: text }
        : mode === 'interactive' ? { ...base, kind: 'interactive', body: question.body, options: question.options.filter((o) => o.trim()) }
        : { ...base, kind: 'template', template_name: tpl.name, template_params: tpl.params.split(',').map((s) => s.trim()).filter(Boolean) })
      await registrarEnvio()
      setText(''); setQuestion({ body: '', options: [] }); if (mode === 'interactive') setMode('text')
      toast('Mensagem enviada'); load(); onSent?.()
    } catch (err) { toast(parouEm ? `Parou na mensagem ${parouEm}: ${err.message}` : err.message, 'err'); load() } finally { setBusy(false); setProgress('') }
  }

  return (
    <div className="wa-split">
     <div className="wa-left stack">
      {header}
      <div className="between">
        <h3>WhatsApp {via && <span className="small muted" style={{ fontWeight: 400 }}>· via {via.label} ({via.phone_display})</span>}</h3>
        {deal && (win
          ? <span className="chip" style={{ '--chip-color': 'var(--success)' }}>janela de 24h aberta</span>
          : <span className="chip" title="Fora da janela de 24h só é possível enviar templates aprovados pela Meta">fora da janela · só template</span>)}
      </div>
      {!settings?.wa_connected && <div className="small muted">WhatsApp ainda não conectado. Configure em Configurações → WhatsApp.</div>}
      <div className="chat" ref={chatRef} onScroll={onChatScroll}>
        {msgs.length === 0 && <div className="small muted" style={{ textAlign: 'center', padding: 12 }}>Nenhuma mensagem ainda.</div>}
        {msgs.map((m) => (
          <div key={m.id} className={'bubble ' + m.direction}>
            {MEDIA_TYPES.includes(m.type) && m.direction === 'in'
              ? <MediaContent m={m} />
              : <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>}
            <div className="meta">{m.channel === 'instagram' && '📷 Instagram · '}{fmtDateTime(m.created_at)}{m.direction === 'out' && ` · ${statusLabel(m.status)}`}{m.error && <span className="late"> · {m.error}</span>}</div>
          </div>
        ))}
      </div>
     </div>
     <div className="wa-right stack">
      <form onSubmit={send} className="stack">
        <div className="pills">
          <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')} disabled={deal && !win} title={deal && !win ? 'Texto livre só dentro das 24h após a última mensagem do lead' : ''}>Texto</button>
          <button type="button" className={mode === 'template' ? 'active' : ''} onClick={() => setMode('template')}>Template</button>
          {mode === 'interactive' && <button type="button" className="active">Pergunta com opções</button>}
          {mode === 'sequence' && <button type="button" className="active">Sequência · {seq.parts.length} mensagens</button>}
          <span className="grow" />
          <button type="button" onClick={abrirMensagens} disabled={deal && !win} title={deal && !win ? 'Mensagens prontas só dentro das 24h após a última mensagem do lead' : 'Escolher uma mensagem pronta'}>⚡ Mensagens prontas</button>
        </div>
        {mode === 'sequence' ? (
          <div className="stack" style={{ gap: 6 }}>
            {seq.parts.map((t, i) => (
              <div key={i} className="stack" style={{ gap: 2 }}>
                <span className="small muted">Mensagem {i + 1}{i === seq.parts.length - 1 && seq.options.length > 0 ? ` · com ${seq.options.length <= 3 ? 'botões' : 'lista de opções'}` : ''}</span>
                <textarea className="textarea" style={{ minHeight: 48 }} value={t} onChange={(e) => setSeq({ ...seq, parts: seq.parts.map((x, j) => (j === i ? e.target.value : x)) })} />
              </div>
            ))}
            {seq.options.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{seq.options.map((o, i) => <span key={i} className="chip">{o}</span>)}</div>}
            <div className="small muted">As mensagens saem uma depois da outra, nesta ordem. Troque o que estiver entre colchetes, como [DATA], antes de enviar. <button type="button" className="btn ghost sm" onClick={() => { setMode('text'); setSeq({ parts: [], options: [] }); setPickedId(null) }}>cancelar</button></div>
          </div>
        ) : mode === 'interactive' ? (
          <div className="stack" style={{ gap: 6 }}>
            <textarea className="textarea" style={{ minHeight: 60 }} value={question.body} onChange={(e) => setQuestion({ ...question, body: e.target.value })} required />
            <div className="row wrap" style={{ gap: 6 }}>
              {question.options.map((o, i) => (
                <span key={i} className="chip">{o} <button type="button" className="close" style={{ fontSize: 13 }} onClick={() => setQuestion({ ...question, options: question.options.filter((_, j) => j !== i) })} aria-label="Remover opção">×</button></span>
              ))}
            </div>
            <div className="small muted">{question.options.length <= 3 ? 'O lead recebe as opções como botões.' : 'O lead recebe um botão "Ver opções" com a lista.'} <button type="button" className="btn ghost sm" onClick={() => { setMode('text'); setQuestion({ body: '', options: [] }); setPickedId(null) }}>cancelar</button></div>
          </div>
        ) : mode === 'text' ? (
          <textarea className="textarea" style={{ minHeight: 60 }} placeholder="Escreva a mensagem…" value={text} onChange={(e) => setText(e.target.value)} required />
        ) : (
          <div className="grid2">
            <Field label="Nome do template (aprovado na Meta)"><input className="input" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} placeholder="mentoria_dia_2" required /></Field>
            <Field label="Variáveis ({{1}}, {{2}}…) separadas por vírgula"><input className="input" value={tpl.params} onChange={(e) => setTpl({ ...tpl, params: e.target.value })} placeholder="Fernanda" /></Field>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary sm" disabled={busy}>{busy ? (progress ? `Enviando ${progress}…` : 'Enviando…') : mode === 'sequence' ? `Enviar ${seq.parts.length} mensagens` : 'Enviar'}</button></div>
        {showQuick && (
          <div className="card" style={{ padding: 6, maxHeight: 340, overflowY: 'auto' }}>
            {quick.length > 0 && <div className="small muted" style={{ padding: '2px 4px 6px' }}>{totalEnviadas} de {sequencia.length} enviadas para este contato{proxima ? '' : ' · sequência completa ✓'}</div>}
            {quick.length > 0 && (
              <select className="select" style={{ marginBottom: 6 }} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Etapa">
                <option value="">Todas as etapas</option>
                {QUICK_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                {quick.some((q) => !q.stage) && <option value="outras">Outras</option>}
              </select>
            )}
            {quick.length === 0 && <div className="small muted" style={{ padding: 8 }}>Nenhuma mensagem pronta. Cadastre em Configurações → Mensagens prontas.</div>}
            {proxima && stage && stage !== 'outras' && proxima.stage !== stage && (
              <button type="button" className="btn ghost sm" style={{ display: 'block', width: '100%', textAlign: 'left', margin: '2px 0 6px' }} onClick={() => setStage(proxima.stage || 'outras')}>
                ✓ Etapa em dia. Próxima: <b>{proxima.title}</b> ({quickStageLabel(proxima.stage)}) →
              </button>
            )}
            {quickVisiveis.map((q) => {
              const em = enviadaEm(q)
              const eProxima = proxima?.id === q.id
              return (
              <div key={q.id} className="row" style={{ gap: 4, alignItems: 'flex-start', borderLeft: eProxima ? '3px solid var(--accent)' : '3px solid transparent', background: eProxima ? 'var(--surface-2)' : undefined, borderRadius: 6 }}>
              <button type="button" className="btn ghost sm" style={{ padding: '6px 6px', fontSize: 16, lineHeight: 1, color: em ? 'var(--success)' : 'var(--border-strong, #bbb)' }} onClick={() => toggleSent(q)} title={em ? 'Enviada. Clique para desmarcar' : 'Marcar como enviada'} aria-label={em ? 'Desmarcar como enviada' : 'Marcar como enviada'}>{em ? '✓' : '○'}</button>
              <button type="button" className="btn ghost grow" style={{ display: 'block', textAlign: 'left', whiteSpace: 'normal', padding: '6px 8px', opacity: em ? 0.6 : 1 }} onClick={() => pick(q)}>
                <b>{q.title}</b>{eProxima && <span className="chip" style={{ marginLeft: 6, '--chip-color': 'var(--accent)', color: 'var(--accent)', fontWeight: 600 }}>próxima</span>}{em && <span className="small" style={{ marginLeft: 6, color: 'var(--success)' }}>enviada {fmtDateTime(em)}</span>}{splitParts(q.body).length > 1 && <span className="chip" style={{ marginLeft: 6 }}>{splitParts(q.body).length} mensagens</span>}{q.options?.length > 0 && <span className="chip" style={{ marginLeft: 6 }}>{q.options.length} opções</span>}{q.auto_before && <span className="chip" style={{ marginLeft: 6 }} title="Sai sozinha antes do encontro">⏰ automática · {AUTO_LABEL[q.auto_before]}</span>}
                <div className="small muted">{splitParts(fill(q.body)).join(' · ').slice(0, 110)}{q.body.length > 110 ? '…' : ''}</div>
              </button>
              </div>
              )
            })}
          </div>
        )}
      </form>
      <div className="card" style={{ padding: 10, background: 'var(--surface-2, #f6f5f1)' }}>
        <div className="between" style={{ marginBottom: 6, gap: 8 }}>
          <div className="small" style={{ fontWeight: 600 }}>📅 Encontro confirmado</div>
          {podeCancelar && <button type="button" className="btn sm" onClick={leadCancelou} disabled={calBusy === 'cancel'} title="Move para Remarcar, libera o horário na agenda e prepara a pergunta de remarcação">{calBusy === 'cancel' ? 'Movendo…' : '↺ Lead cancelou → Remarcar'}</button>}
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="small stack" style={{ gap: 2 }}>Dia
            <input className="input" type="date" value={meeting.date} onChange={(e) => saveMeeting({ date: e.target.value })} style={{ width: 160 }} />
          </label>
          <label className="small stack" style={{ gap: 2 }}>Hora
            <input className="input" type="time" value={meeting.time} onChange={(e) => saveMeeting({ time: e.target.value })} style={{ width: 120 }} />
          </label>
          <label className="small stack grow" style={{ gap: 2, minWidth: 180 }}>Link do Google Meet (opcional)
            <input className="input" value={meeting.link} placeholder="meet.google.com/..." onChange={(e) => setMeeting({ ...meeting, link: e.target.value })} onBlur={(e) => saveMeeting({ link: e.target.value })} />
          </label>
        </div>
        {deal?.id && (
          <div className="cal-box">
            <div className="small" style={{ fontWeight: 600 }}>Agenda Google</div>
            {activeSellers.length === 0 ? (
              <div className="small muted">Cadastre as vendedoras em Configurações → Agenda Google para buscar os horários automaticamente.</div>
            ) : booked ? (
              <div className="row wrap small" style={{ gap: 8 }}>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Reservado na agenda de {sellerName(booked.sellerId) || 'vendedora'}{meeting.link ? ' · com Google Meet' : ''}</span>
                <button type="button" className="btn ghost sm" onClick={desfazerReserva} disabled={calBusy === 'release'}>{calBusy === 'release' ? 'Desfazendo…' : 'Desfazer reserva'}</button>
              </div>
            ) : (
              <>
                <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
                  <select className="select" value={sellerId} onChange={(e) => { setSellerId(e.target.value); setFound(null) }} aria-label="Vendedora" style={{ width: 'auto', minWidth: 160 }}>
                    {activeSellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" className="btn sm" onClick={buscarHorarios} disabled={calBusy === 'buscar'}>{calBusy === 'buscar' ? 'Buscando…' : 'Buscar horários livres'}</button>
                </div>
                {found && found.length > 0 && (
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="small muted">Toque para escolher os 2 horários oferecidos (entram em [DIA 1]/[HORA 1] e [DIA 2]/[HORA 2]):</div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {found.map((s) => {
                        const on = offered.some((o) => o.event_id === s.event_id)
                        return <button key={s.event_id} type="button" className={'slot-chip' + (on ? ' on' : '')} onClick={() => alternarOferta(s)} aria-pressed={on}>{on ? '✓ ' : ''}{slotLabel(s)}</button>
                      })}
                    </div>
                  </div>
                )}
                {offered.length > 0 && (
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="small">Oferecidos{offered[0]?.seller_id ? ` (agenda de ${sellerName(offered[0].seller_id)})` : ''}. Quando o lead escolher, reserve:</div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {offered.map((s) => (
                        <button key={s.event_id} type="button" className="btn primary sm" onClick={() => reservar(s)} disabled={!!calBusy}>{calBusy === s.event_id ? 'Reservando…' : `Reservar ${slotLabel(s)}`}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {activeSellers.length > 1 && (
              <div className="stack" style={{ gap: 4 }}>
                <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={abrirTroca}>⇄ Trocar de vendedora (mesmo horário)</button>
                {moveOpen && (
                  <div className="row wrap small" style={{ gap: 6, alignItems: 'center' }}>
                    Da agenda de
                    <select className="select" value={moveFrom} onChange={(e) => setMoveFrom(e.target.value)} aria-label="Agenda atual" style={{ width: 'auto' }}>
                      {activeSellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    para
                    <select className="select" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Nova agenda" style={{ width: 'auto' }}>
                      {activeSellers.filter((s) => s.id !== moveFrom).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button type="button" className="btn primary sm" onClick={trocarVendedora} disabled={calBusy === 'transfer'}>{calBusy === 'transfer' ? 'Procurando…' : 'Mover encontro'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {deal?.id && meeting.date && meeting.time && quick.some((q) => q.auto_before) && (
          <div className="small" style={{ marginTop: 6 }}>⏰ Lembretes automáticos: {['4h', '1h', '15m'].filter((k) => quick.some((q) => q.auto_before === k)).map((k) => {
            const v = (deal?.reminders || {})[k]
            return <span key={k} style={{ marginRight: 10 }}>{AUTO_LABEL[k]} {v === 'tarefa' ? '⚠️ tarefa' : v === 'pulado' ? '— pulado' : v ? '✓' : '· agendado'}</span>
          })}</div>
        )}
        <div className="small muted" style={{ marginTop: 6 }}>
          {meeting.date && meeting.time
            ? <>As mensagens prontas já saem com <b>{meetingDateLabel(meeting.date)} às {meetingTimeLabel(meeting.time)}</b>{meeting.link ? ' e o link' : ''}.</>
            : 'Preencha depois que o lead escolher o horário: o dia e a hora entram sozinhos em todas as mensagens prontas.'}
        </div>
      </div>
     </div>
    </div>
  )
}

const AUTO_LABEL = { '4h': '4h antes', '1h': '1h antes', '15m': '15 min antes' }
const statusLabel = (s) => ({ sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' }[s] || s || '')

const MEDIA_LABEL = { audio: '▶ Ouvir áudio', image: '🖼 Ver foto', video: '▶ Ver vídeo', document: '📄 Abrir documento', sticker: '🖼 Ver figurinha' }

/** Áudio/foto/vídeo/documento recebido: busca o arquivo só quando a pessoa clica. */
function MediaContent({ m }) {
  const [media, setMedia] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const caption = (m.body || '').replace(/^\[[^\]]+\]\s*/, '')
  const abrir = async () => {
    setLoading(true); setErr('')
    try { setMedia(await getMedia(m.id)) } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      {!media && (
        <button type="button" className="btn sm" onClick={abrir} disabled={loading} style={{ alignSelf: 'flex-start' }}>
          {loading ? 'Carregando…' : MEDIA_LABEL[m.type] || 'Abrir arquivo'}
        </button>
      )}
      {media && m.type === 'audio' && (
        <div className="stack" style={{ gap: 2 }}>
          <audio controls autoPlay src={media.url} style={{ maxWidth: 260 }} />
          <a className="small" href={media.url} target="_blank" rel="noreferrer">baixar áudio</a>
        </div>
      )}
      {media && (m.type === 'image' || m.type === 'sticker') && (
        <a href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt="Foto enviada pelo lead" style={{ maxWidth: 240, maxHeight: 240, borderRadius: 8, display: 'block' }} /></a>
      )}
      {media && m.type === 'video' && <video controls src={media.url} style={{ maxWidth: 260, borderRadius: 8 }} />}
      {media && m.type === 'document' && <a href={media.url} target="_blank" rel="noreferrer">📄 Abrir documento</a>}
      {err && <div className="small late">{err}</div>}
      {caption && <div style={{ whiteSpace: 'pre-wrap' }}>{caption}</div>}
    </div>
  )
}
