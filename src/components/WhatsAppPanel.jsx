import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { inWindow, sendWhatsApp, QUICK_STAGES, splitParts, pendingFields } from '../lib/wa'
import { fmtDateTime } from '../lib/utils'
import { Field } from './ui'

/** Conversa de WhatsApp de um contato (com envio). deal opcional para vincular e calcular a janela de 24h. */
export default function WhatsAppPanel({ contactId, deal, onSent }) {
  const { toast, settings, waNumbers } = useApp()
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
  const [firstName, setFirstName] = useState('')
  const endRef = useRef(null)
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
  const fill = (t = '') => t.replace(/{{primeiro_nome}}/g, firstName).replace(/{{nome}}/g, firstName)
  const pick = (q) => {
    setShowQuick(false)
    const parts = splitParts(q.body)
    if (parts.length > 1) { setSeq({ parts: parts.map(fill), options: [...(q.options || [])] }); setMode('sequence'); return }
    if (q.options?.length) { setQuestion({ body: fill(q.body), options: [...q.options] }); setMode('interactive') }
    else { setText(fill(q.body)); setMode('text') }
  }
  const quickVisiveis = quick.filter((q) => !stage || (stage === 'outras' ? !q.stage : q.stage === stage))
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [msgs.length])
  useEffect(() => { setMode(win ? 'text' : 'template') }, [win])

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
        setSeq({ parts: [], options: [] }); setMode('text'); setProgress('')
        toast(`${parts.length} mensagens enviadas`); load(); onSent?.()
        return
      }
      await sendWhatsApp(mode === 'text' ? { ...base, kind: 'text', body: text }
        : mode === 'interactive' ? { ...base, kind: 'interactive', body: question.body, options: question.options.filter((o) => o.trim()) }
        : { ...base, kind: 'template', template_name: tpl.name, template_params: tpl.params.split(',').map((s) => s.trim()).filter(Boolean) })
      setText(''); setQuestion({ body: '', options: [] }); if (mode === 'interactive') setMode('text')
      toast('Mensagem enviada'); load(); onSent?.()
    } catch (err) { toast(parouEm ? `Parou na mensagem ${parouEm}: ${err.message}` : err.message, 'err'); load() } finally { setBusy(false); setProgress('') }
  }

  return (
    <div className="stack">
      <div className="between">
        <h3>WhatsApp {via && <span className="small muted" style={{ fontWeight: 400 }}>· via {via.label} ({via.phone_display})</span>}</h3>
        {deal && (win
          ? <span className="chip" style={{ '--chip-color': 'var(--success)' }}>janela de 24h aberta</span>
          : <span className="chip" title="Fora da janela de 24h só é possível enviar templates aprovados pela Meta">fora da janela · só template</span>)}
      </div>
      {!settings?.wa_connected && <div className="small muted">WhatsApp ainda não conectado. Configure em Configurações → WhatsApp.</div>}
      <div className="chat">
        {msgs.length === 0 && <div className="small muted" style={{ textAlign: 'center', padding: 12 }}>Nenhuma mensagem ainda.</div>}
        {msgs.map((m) => (
          <div key={m.id} className={'bubble ' + m.direction}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            <div className="meta">{m.channel === 'instagram' && '📷 Instagram · '}{fmtDateTime(m.created_at)}{m.direction === 'out' && ` · ${statusLabel(m.status)}`}{m.error && <span className="late"> · {m.error}</span>}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="stack">
        <div className="pills">
          <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')} disabled={deal && !win} title={deal && !win ? 'Texto livre só dentro das 24h após a última mensagem do lead' : ''}>Texto</button>
          <button type="button" className={mode === 'template' ? 'active' : ''} onClick={() => setMode('template')}>Template</button>
          {mode === 'interactive' && <button type="button" className="active">Pergunta com opções</button>}
          {mode === 'sequence' && <button type="button" className="active">Sequência · {seq.parts.length} mensagens</button>}
          <span className="grow" />
          <button type="button" onClick={() => setShowQuick((v) => !v)} disabled={deal && !win} title={deal && !win ? 'Mensagens prontas só dentro das 24h após a última mensagem do lead' : 'Escolher uma mensagem pronta'}>⚡ Mensagens prontas</button>
        </div>
        {showQuick && (
          <div className="card" style={{ padding: 6, maxHeight: 220, overflowY: 'auto' }}>
            {quick.length > 0 && (
              <select className="select" style={{ marginBottom: 6 }} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Etapa">
                <option value="">Todas as etapas</option>
                {QUICK_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                {quick.some((q) => !q.stage) && <option value="outras">Outras</option>}
              </select>
            )}
            {quick.length === 0 && <div className="small muted" style={{ padding: 8 }}>Nenhuma mensagem pronta. Cadastre em Configurações → Mensagens prontas.</div>}
            {quickVisiveis.map((q) => (
              <button type="button" key={q.id} className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', padding: '6px 8px' }} onClick={() => pick(q)}>
                <b>{q.title}</b>{splitParts(q.body).length > 1 && <span className="chip" style={{ marginLeft: 6 }}>{splitParts(q.body).length} mensagens</span>}{q.options?.length > 0 && <span className="chip" style={{ marginLeft: 6 }}>{q.options.length} opções</span>}
                <div className="small muted">{fill(q.body).slice(0, 110)}{q.body.length > 110 ? '…' : ''}</div>
              </button>
            ))}
          </div>
        )}
        {mode === 'sequence' ? (
          <div className="stack" style={{ gap: 6 }}>
            {seq.parts.map((t, i) => (
              <div key={i} className="stack" style={{ gap: 2 }}>
                <span className="small muted">Mensagem {i + 1}{i === seq.parts.length - 1 && seq.options.length > 0 ? ` · com ${seq.options.length <= 3 ? 'botões' : 'lista de opções'}` : ''}</span>
                <textarea className="textarea" style={{ minHeight: 48 }} value={t} onChange={(e) => setSeq({ ...seq, parts: seq.parts.map((x, j) => (j === i ? e.target.value : x)) })} />
              </div>
            ))}
            {seq.options.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{seq.options.map((o, i) => <span key={i} className="chip">{o}</span>)}</div>}
            <div className="small muted">As mensagens saem uma depois da outra, nesta ordem. Troque o que estiver entre colchetes, como [DATA], antes de enviar. <button type="button" className="btn ghost sm" onClick={() => { setMode('text'); setSeq({ parts: [], options: [] }) }}>cancelar</button></div>
          </div>
        ) : mode === 'interactive' ? (
          <div className="stack" style={{ gap: 6 }}>
            <textarea className="textarea" style={{ minHeight: 60 }} value={question.body} onChange={(e) => setQuestion({ ...question, body: e.target.value })} required />
            <div className="row wrap" style={{ gap: 6 }}>
              {question.options.map((o, i) => (
                <span key={i} className="chip">{o} <button type="button" className="close" style={{ fontSize: 13 }} onClick={() => setQuestion({ ...question, options: question.options.filter((_, j) => j !== i) })} aria-label="Remover opção">×</button></span>
              ))}
            </div>
            <div className="small muted">{question.options.length <= 3 ? 'O lead recebe as opções como botões.' : 'O lead recebe um botão "Ver opções" com a lista.'} <button type="button" className="btn ghost sm" onClick={() => { setMode('text'); setQuestion({ body: '', options: [] }) }}>cancelar</button></div>
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
      </form>
    </div>
  )
}

const statusLabel = (s) => ({ sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' }[s] || s || '')
