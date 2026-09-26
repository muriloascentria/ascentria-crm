import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { inWindow, sendWhatsApp } from '../lib/wa'
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
  const endRef = useRef(null)
  const win = inWindow(deal)

  const load = useCallback(async () => {
    const { data } = await supabase.from('wa_messages').select('*').eq('contact_id', contactId).order('created_at')
    setMsgs(data || [])
  }, [contactId])
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [msgs.length])
  useEffect(() => { setMode(win ? 'text' : 'template') }, [win])

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await sendWhatsApp(mode === 'text'
        ? { contact_id: contactId, deal_id: deal?.id, wa_number_id: deal?.wa_number_id || undefined, kind: 'text', body: text }
        : { contact_id: contactId, deal_id: deal?.id, wa_number_id: deal?.wa_number_id || undefined, kind: 'template', template_name: tpl.name, template_params: tpl.params.split(',').map((s) => s.trim()).filter(Boolean) })
      setText(''); toast('Mensagem enviada'); load(); onSent?.()
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
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
        </div>
        {mode === 'text' ? (
          <textarea className="textarea" style={{ minHeight: 60 }} placeholder="Escreva a mensagem…" value={text} onChange={(e) => setText(e.target.value)} required />
        ) : (
          <div className="grid2">
            <Field label="Nome do template (aprovado na Meta)"><input className="input" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} placeholder="mentoria_dia_2" required /></Field>
            <Field label="Variáveis ({{1}}, {{2}}…) separadas por vírgula"><input className="input" value={tpl.params} onChange={(e) => setTpl({ ...tpl, params: e.target.value })} placeholder="Fernanda" /></Field>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary sm" disabled={busy}>{busy ? 'Enviando…' : 'Enviar'}</button></div>
      </form>
    </div>
  )
}

const statusLabel = (s) => ({ sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' }[s] || s || '')
