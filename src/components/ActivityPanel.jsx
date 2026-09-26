import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { ACTIVITY_TYPES, fmtDateTime, relativeDay, toLocalInput } from '../lib/utils'
import { Field, Modal, UserSelect } from './ui'

/** Formulário de atividade (criação/edição). `link` = { deal_id | contact_id | company_id } */
export function ActivityForm({ initial, link, onSaved, onClose }) {
  const { toast, profile } = useApp()
  const [f, setF] = useState(() => ({
    type: 'task', title: '', description: '', due_at: toLocalInput(new Date(Date.now() + 86400000)),
    assigned_to: profile.id, done: false, ...initial, ...(initial?.due_at ? { due_at: toLocalInput(initial.due_at) } : {}),
  }))
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async (e) => {
    e.preventDefault()
    const payload = {
      type: f.type, title: f.title, description: f.description || null,
      due_at: f.due_at ? new Date(f.due_at).toISOString() : null,
      assigned_to: f.assigned_to, done: f.done, ...link,
    }
    const q = initial?.id ? supabase.from('activities').update(payload).eq('id', initial.id) : supabase.from('activities').insert(payload)
    const { error } = await q
    if (error) return toast(error.message, 'err')
    toast(initial?.id ? 'Atividade atualizada' : 'Atividade criada')
    onSaved?.(); onClose?.()
  }
  return (
    <Modal title={initial?.id ? 'Editar atividade' : 'Nova atividade'} onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="actform">Salvar</button></>}>
      <form id="actform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <div className="pills">
          {Object.entries(ACTIVITY_TYPES).map(([k, v]) => (
            <button type="button" key={k} className={f.type === k ? 'active' : ''} onClick={() => set('type', k)}>{v.icon} {v.label}</button>
          ))}
        </div>
        <Field label="Título"><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} required autoFocus /></Field>
        <div className="grid2">
          <Field label="Data e hora"><input className="input" type="datetime-local" value={f.due_at} onChange={(e) => set('due_at', e.target.value)} /></Field>
          <Field label="Responsável"><UserSelect value={f.assigned_to} onChange={(v) => set('assigned_to', v)} /></Field>
        </div>
        <Field label="Descrição"><textarea className="textarea" value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={f.done} onChange={(e) => set('done', e.target.checked)} /> Concluída</label>
      </form>
    </Modal>
  )
}

/** Lista de atividades ligadas a um registro (deal/contact/company). */
export function ActivityPanel({ link }) {
  const { toast, users } = useApp()
  const [items, setItems] = useState([])
  const [editing, setEditing] = useState(null)
  const key = Object.keys(link)[0]

  const load = useCallback(async () => {
    const { data } = await supabase.from('activities').select('*').eq(key, link[key]).order('done').order('due_at', { ascending: true })
    setItems(data || [])
  }, [key, link])
  useEffect(() => { load() }, [load])

  const toggle = async (a) => {
    const { error } = await supabase.from('activities').update({ done: !a.done }).eq('id', a.id)
    if (error) return toast(error.message, 'err')
    load()
  }
  const remove = async (a) => {
    if (!window.confirm('Excluir atividade?')) return
    await supabase.from('activities').delete().eq('id', a.id); load()
  }
  const userName = (id) => users.find((u) => u.id === id)?.full_name || ''

  return (
    <div className="stack">
      <div className="between"><h3>Atividades</h3><button className="btn sm" type="button" onClick={() => setEditing({})}>+ Nova</button></div>
      {items.length === 0 && <div className="small muted">Nenhuma atividade ainda.</div>}
      <div className="timeline">
        {items.map((a) => <ActivityRow key={a.id} a={a} onToggle={toggle} onEdit={() => setEditing(a)} onRemove={remove} who={userName(a.assigned_to)} />)}
      </div>
      {editing && <ActivityForm initial={editing.id ? editing : null} link={link} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  )
}

export function ActivityRow({ a, onToggle, onEdit, onRemove, who, context }) {
  const late = !a.done && a.due_at && new Date(a.due_at) < new Date()
  return (
    <div className={'act' + (a.done ? ' done' : '')}>
      <input type="checkbox" checked={a.done} onChange={() => onToggle(a)} title="Concluir" />
      <span className="ico">{ACTIVITY_TYPES[a.type]?.icon}</span>
      <div className="grow" style={{ minWidth: 0, cursor: 'pointer' }} onClick={onEdit}>
        <div className="t">{a.title}</div>
        <div className="small muted">
          {a.due_at && <span className={late ? 'late' : ''}>{fmtDateTime(a.due_at)} ({relativeDay(a.due_at)})</span>}
          {who && <> · {who}</>}
          {context && <> · {context}</>}
        </div>
        {a.description && <div className="small" style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.description}</div>}
      </div>
      {onRemove && <button className="btn ghost sm" type="button" onClick={() => onRemove(a)} title="Excluir">🗑</button>}
    </div>
  )
}
