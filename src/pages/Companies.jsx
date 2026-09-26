import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtDate } from '../lib/utils'
import { ConfirmButton, CustomFieldsForm, CustomFieldsView, Empty, Field, Modal, UserSelect } from '../components/ui'
import { ActivityPanel } from '../components/ActivityPanel'
import { ContactForm } from './Contacts'

export default function Companies() {
  const { toast, users, label } = useApp()
  const { id } = useParams()
  const nav = useNavigate()
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('companies').select('*, contacts(count)').order('name')
    if (error) toast(error.message, 'err')
    setList(data || []); setLoading(false)
  }, [toast])
  useEffect(() => { load() }, [load])

  const filtered = list.filter((c) => !q || [c.name, c.domain, c.segment, c.city].join(' ').toLowerCase().includes(q.toLowerCase()))
  const selected = id ? list.find((c) => c.id === id) : null

  return (
    <>
      <div className="page-head">
        <h1>{label('companies')} <span className="muted" style={{ fontWeight: 400 }}>({list.length})</span></h1>
        <div className="row">
          <input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
          <button className="btn primary" onClick={() => setEditing({})}>+ Empresa</button>
        </div>
      </div>
      {!loading && filtered.length === 0 ? <Empty title="Nenhuma empresa" text="Cadastre as empresas dos seus contatos." action={<button className="btn primary" onClick={() => setEditing({})}>+ Empresa</button>} /> : (
        <div className="card pad0">
          <table className="tbl">
            <thead><tr><th>Nome</th><th>Segmento</th><th>Cidade</th><th>Contatos</th><th>Responsável</th><th>Criada</th></tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => nav(`/empresas/${c.id}`)}>
                  <td><b>{c.name}</b>{c.domain && <div className="small muted">{c.domain}</div>}</td>
                  <td>{c.segment || '—'}</td><td>{c.city || '—'}</td>
                  <td>{c.contacts?.[0]?.count ?? 0}</td>
                  <td className="small">{users.find((u) => u.id === c.owner_id)?.full_name || ''}</td>
                  <td className="small muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <CompanyDetail company={selected} onClose={() => nav('/empresas')} onEdit={() => setEditing(selected)} onChanged={load} />}
      {editing && <CompanyForm initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  )
}

function CompanyForm({ initial, onClose, onSaved }) {
  const { toast, profile } = useApp()
  const [f, setF] = useState({ name: '', domain: '', phone: '', segment: '', city: '', notes: '', owner_id: profile.id, custom: {}, ...(initial || {}) })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async (e) => {
    e.preventDefault()
    const payload = { name: f.name, domain: f.domain || null, phone: f.phone || null, segment: f.segment || null, city: f.city || null, notes: f.notes || null, owner_id: f.owner_id || null, custom: f.custom || {} }
    const q = initial?.id ? supabase.from('companies').update(payload).eq('id', initial.id) : supabase.from('companies').insert(payload)
    const { error } = await q
    if (error) return toast(error.message, 'err')
    toast('Empresa salva'); onSaved(); onClose()
  }
  return (
    <Modal title={initial?.id ? 'Editar empresa' : 'Nova empresa'} onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="coform">Salvar</button></>}>
      <form id="coform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <Field label="Nome"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></Field>
        <div className="grid2">
          <Field label="Site / domínio"><input className="input" value={f.domain || ''} onChange={(e) => set('domain', e.target.value)} /></Field>
          <Field label="Telefone"><input className="input" value={f.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Segmento"><input className="input" value={f.segment || ''} onChange={(e) => set('segment', e.target.value)} /></Field>
          <Field label="Cidade"><input className="input" value={f.city || ''} onChange={(e) => set('city', e.target.value)} /></Field>
        </div>
        <Field label="Responsável"><UserSelect value={f.owner_id} onChange={(v) => set('owner_id', v)} /></Field>
        <CustomFieldsForm entity="company" values={f.custom} onChange={(v) => set('custom', v)} />
        <Field label="Observações"><textarea className="textarea" value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </form>
    </Modal>
  )
}

function CompanyDetail({ company: c, onClose, onEdit, onChanged }) {
  const { toast } = useApp()
  const nav = useNavigate()
  const [contacts, setContacts] = useState([])
  const [newContact, setNewContact] = useState(false)
  const loadContacts = useCallback(() => supabase.from('contacts').select('id,name,email,phone,job_title').eq('company_id', c.id).order('name').then(({ data }) => setContacts(data || [])), [c.id])
  useEffect(() => { loadContacts() }, [loadContacts])
  const remove = async () => {
    const { error } = await supabase.from('companies').delete().eq('id', c.id)
    if (error) return toast(error.message, 'err')
    toast('Empresa excluída'); onChanged(); onClose()
  }
  return (
    <Modal title={c.name} onClose={onClose} wide
      footer={<><ConfirmButton onConfirm={remove} className="btn danger">Excluir</ConfirmButton><span className="grow" /><button className="btn" onClick={onEdit}>Editar</button></>}>
      <div className="detail-grid">
        <div className="stack" style={{ gap: 14 }}>
          <div className="grid2">
            <div><div className="small muted">Site</div><div>{c.domain || '—'}</div></div>
            <div><div className="small muted">Telefone</div><div>{c.phone || '—'}</div></div>
            <div><div className="small muted">Segmento</div><div>{c.segment || '—'}</div></div>
            <div><div className="small muted">Cidade</div><div>{c.city || '—'}</div></div>
          </div>
          <CustomFieldsView entity="company" values={c.custom} />
          {c.notes && <div><div className="small muted">Observações</div><div style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</div></div>}
          <div className="stack">
            <div className="between"><h3>Contatos</h3><button className="btn sm" onClick={() => setNewContact(true)}>+ Novo</button></div>
            {contacts.length === 0 && <div className="small muted">Nenhum contato vinculado.</div>}
            {contacts.map((ct) => (
              <div key={ct.id} className="act" style={{ cursor: 'pointer' }} onClick={() => nav(`/contatos/${ct.id}`)}>
                <div className="grow"><div className="t">{ct.name}</div><div className="small muted">{[ct.job_title, ct.email, ct.phone].filter(Boolean).join(' · ')}</div></div>
              </div>
            ))}
          </div>
        </div>
        <ActivityPanel link={{ company_id: c.id }} />
      </div>
      {newContact && <ContactForm defaults={{ company_id: c.id }} onClose={() => setNewContact(false)} onSaved={() => { loadContacts(); onChanged() }} />}
    </Modal>
  )
}
