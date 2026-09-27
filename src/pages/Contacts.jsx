import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtMoney, fmtDate, SOURCES } from '../lib/utils'
import { Avatar, ConfirmButton, CustomFieldsForm, CustomFieldsView, Empty, Field, Modal, UserSelect } from '../components/ui'
import { ActivityPanel } from '../components/ActivityPanel'
import DealModal from '../components/DealModal'

export default function Contacts() {
  const { toast, users, label, settings } = useApp()
  const { id } = useParams()
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false })
    if (error) toast(error.message, 'err')
    setList(data || []); setLoading(false)
  }, [toast])
  useEffect(() => { load() }, [load])

  const filtered = list.filter((c) => !q || [c.name, c.email, c.phone, ...(c.tags || [])].join(' ').toLowerCase().includes(q.toLowerCase()))
  const userName = (uid) => users.find((u) => u.id === uid)?.full_name || ''
  const selected = id ? list.find((c) => c.id === id) : null

  return (
    <>
      <div className="page-head">
        <h1>{label('contacts')} <span className="muted" style={{ fontWeight: 400 }}>({list.length})</span></h1>
        <div className="row">
          <input className="input" placeholder="Buscar por nome, e-mail, telefone, tag…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
          <button className="btn primary" onClick={() => setEditing({})}>+ Contato</button>
        </div>
      </div>
      {!loading && filtered.length === 0 ? <Empty title="Nenhum contato" text="Cadastre seu primeiro lead ou cliente." action={<button className="btn primary" onClick={() => setEditing({})}>+ Contato</button>} /> : (
        <div className="card pad0">
          <table className="tbl">
            <thead><tr><th>Nome</th><th>Contato</th><th>Origem</th><th>Tags</th><th>Responsável</th><th>Criado</th></tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => nav(`/contatos/${c.id}`)}>
                  <td><div className="row"><Avatar sm name={c.name} /><b>{c.name}</b></div>{(c.job_title || c.ig_username) && <div className="small muted">{c.job_title}{c.job_title && c.ig_username ? ' · ' : ''}{c.ig_username && `@${c.ig_username}`}</div>}</td>
                  <td><div>{c.email || ''}</div><div className="small muted">{c.phone || ''}</div></td>
                  <td>{c.source || '—'}</td>
                  <td>{(c.tags || []).map((t) => <span key={t} className="tag" style={{ marginRight: 4 }}>{t}</span>)}</td>
                  <td className="small">{userName(c.owner_id)}</td>
                  <td className="small muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <ContactDetail contact={selected} onClose={() => nav('/contatos')} onEdit={() => setEditing(selected)} onChanged={load} currency={settings.currency} />}
      {editing && <ContactForm initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  )
}

export function ContactForm({ initial, onClose, onSaved, defaults = {} }) {
  const { toast, profile } = useApp()
  const [f, setF] = useState({ name: '', email: '', phone: '', job_title: '', source: '', tags: '', notes: '', owner_id: profile.id, custom: {}, ...defaults, ...(initial || {}), tags: (initial?.tags || []).join(', ') })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  const save = async (e) => {
    e.preventDefault()
    const payload = {
      name: f.name, email: f.email || null, phone: f.phone || null, job_title: f.job_title || null, source: f.source || null,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), notes: f.notes || null,
      owner_id: f.owner_id || null, custom: f.custom || {},
    }
    const q = initial?.id ? supabase.from('contacts').update(payload).eq('id', initial.id) : supabase.from('contacts').insert(payload).select().single()
    const { data, error } = await q
    if (error) return toast(error.message, 'err')
    toast('Contato salvo'); onSaved?.(data); onClose()
  }
  return (
    <Modal title={initial?.id ? 'Editar contato' : 'Novo contato'} onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="cform">Salvar</button></>}>
      <form id="cform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <Field label="Nome"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></Field>
        <div className="grid2">
          <Field label="E-mail"><input className="input" type="email" value={f.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Telefone / WhatsApp"><input className="input" value={f.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>
        <Field label="Cargo"><input className="input" value={f.job_title || ''} onChange={(e) => set('job_title', e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Origem">
            <select className="select" value={f.source || ''} onChange={(e) => set('source', e.target.value)}>
              <option value="">—</option>{SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Responsável"><UserSelect value={f.owner_id} onChange={(v) => set('owner_id', v)} /></Field>
        </div>
        <Field label="Tags" hint="Separe por vírgula. Ex.: quente, indicação"><input className="input" value={f.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        <CustomFieldsForm entity="contact" values={f.custom} onChange={(v) => set('custom', v)} />
        <Field label="Observações"><textarea className="textarea" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </form>
    </Modal>
  )
}

function ContactDetail({ contact: c, onClose, onEdit, onChanged, currency }) {
  const { toast, users, stages } = useApp()
  const [deals, setDeals] = useState([])
  const [dealModal, setDealModal] = useState(null)
  const loadDeals = useCallback(() => supabase.from('deals').select('*').eq('contact_id', c.id).order('created_at', { ascending: false }).then(({ data }) => setDeals(data || [])), [c.id])
  useEffect(() => { loadDeals() }, [loadDeals])
  const remove = async () => {
    const { error } = await supabase.from('contacts').delete().eq('id', c.id)
    if (error) return toast(error.message, 'err')
    toast('Contato excluído'); onChanged(); onClose()
  }
  const stageName = (id) => stages.find((s) => s.id === id)?.name
  return (
    <Modal title={c.name} onClose={onClose} wide
      footer={<><ConfirmButton onConfirm={remove} className="btn danger">Excluir</ConfirmButton><span className="grow" /><button className="btn" onClick={onEdit}>Editar</button></>}>
      <div className="detail-grid">
        <div className="stack" style={{ gap: 14 }}>
          <div className="grid2">
            <div><div className="small muted">E-mail</div><div>{c.email || '—'}</div></div>
            <div><div className="small muted">Telefone</div><div>{c.phone ? <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>{c.phone}</a> : '—'}</div></div>
            <div><div className="small muted">Cargo</div><div>{c.job_title || '—'}</div></div>
            <div><div className="small muted">Origem</div><div>{c.source || '—'}</div></div>
            <div><div className="small muted">Responsável</div><div>{users.find((u) => u.id === c.owner_id)?.full_name || '—'}</div></div>
          </div>
          {c.tags?.length > 0 && <div className="row wrap">{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
          <CustomFieldsView entity="contact" values={c.custom} />
          {c.notes && <div><div className="small muted">Observações</div><div style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div></div>}
          <div className="stack">
            <div className="between"><h3>Negócios</h3><button className="btn sm" onClick={() => setDealModal({ defaults: { contact_id: c.id } })}>+ Novo</button></div>
            {deals.length === 0 && <div className="small muted">Nenhum negócio.</div>}
            {deals.map((d) => (
              <div key={d.id} className="act" style={{ cursor: 'pointer' }} onClick={() => setDealModal({ deal: d })}>
                <div className="grow"><div className="t">{d.title}</div><div className="small muted">{stageName(d.stage_id)} · {fmtMoney(d.value, currency)}</div></div>
                <span className="chip">{d.status === 'won' ? 'Ganho' : d.status === 'lost' ? 'Perdido' : 'Aberto'}</span>
              </div>
            ))}
          </div>
        </div>
        <ActivityPanel link={{ contact_id: c.id }} />
      </div>
      {dealModal && <DealModal deal={dealModal.deal} defaults={dealModal.defaults} onClose={() => setDealModal(null)} onSaved={loadDeals} />}
    </Modal>
  )
}
