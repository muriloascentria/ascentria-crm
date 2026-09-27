import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { Empty } from '../components/ui'
import { ActivityForm, ActivityRow } from '../components/ActivityPanel'
import DealModal from '../components/DealModal'

const FILTERS = [
  { k: 'today', t: 'Hoje' }, { k: 'overdue', t: 'Atrasadas' }, { k: 'week', t: 'Próximos 7 dias' }, { k: 'open', t: 'Todas abertas' }, { k: 'done', t: 'Concluídas' },
]

export default function Activities() {
  const { toast, users, profile, label } = useApp()
  const nav = useNavigate()
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('today')
  const [onlyMine, setOnlyMine] = useState(true)
  const [editing, setEditing] = useState(null)
  const [dealOpen, setDealOpen] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('activities')
      .select('*, deal:deals(id,title), contact:contacts(id,name)')
      .order('due_at', { ascending: true, nullsFirst: false })
    if (error) toast(error.message, 'err')
    setItems(data || [])
  }, [toast])
  useEffect(() => { load() }, [load])

  const now = new Date()
  const startToday = new Date(now.toDateString())
  const endToday = new Date(startToday.getTime() + 86400000)
  const in7 = new Date(startToday.getTime() + 7 * 86400000)
  const visible = items.filter((a) => {
    if (onlyMine && a.assigned_to !== profile.id) return false
    const d = a.due_at ? new Date(a.due_at) : null
    switch (filter) {
      case 'today': return !a.done && d && d < endToday
      case 'overdue': return !a.done && d && d < now
      case 'week': return !a.done && d && d < in7
      case 'open': return !a.done
      case 'done': return a.done
      default: return true
    }
  })

  const toggle = async (a) => {
    const { error } = await supabase.from('activities').update({ done: !a.done }).eq('id', a.id)
    if (error) return toast(error.message, 'err'); load()
  }
  const remove = async (a) => { if (window.confirm('Excluir atividade?')) { await supabase.from('activities').delete().eq('id', a.id); load() } }
  const ctx = (a) => {
    if (a.deal) return <a onClick={(e) => { e.stopPropagation(); setDealOpen(a.deal.id) }} style={{ color: 'var(--primary)', cursor: 'pointer' }}>💼 {a.deal.title}</a>
    if (a.contact) return <a onClick={(e) => { e.stopPropagation(); nav(`/contatos/${a.contact.id}`) }} style={{ color: 'var(--primary)', cursor: 'pointer' }}>☺ {a.contact.name}</a>
    return null
  }

  return (
    <>
      <div className="page-head">
        <h1>{label('activities')}</h1>
        <div className="row wrap">
          <label className="check small"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Só minhas</label>
          <button className="btn primary" onClick={() => setEditing({})}>+ Atividade</button>
        </div>
      </div>
      <div className="pills" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => <button key={f.k} className={filter === f.k ? 'active' : ''} onClick={() => setFilter(f.k)}>{f.t}</button>)}
      </div>
      {visible.length === 0 ? <Empty title="Nada por aqui" text={filter === 'today' ? 'Você não tem atividades pendentes para hoje.' : 'Nenhuma atividade neste filtro.'} /> : (
        <div className="timeline">
          {visible.map((a) => <ActivityRow key={a.id} a={a} onToggle={toggle} onEdit={() => setEditing(a)} onRemove={remove}
            who={!onlyMine ? users.find((u) => u.id === a.assigned_to)?.full_name : ''} context={ctx(a)} />)}
        </div>
      )}
      {editing && <ActivityForm initial={editing.id ? editing : null} link={editing.id ? {} : {}} onClose={() => setEditing(null)} onSaved={load} />}
      {dealOpen && <DealLoader id={dealOpen} onClose={() => setDealOpen(null)} onSaved={load} />}
    </>
  )
}

function DealLoader({ id, onClose, onSaved }) {
  const [deal, setDeal] = useState(null)
  useEffect(() => { supabase.from('deals').select('*').eq('id', id).single().then(({ data }) => setDeal(data)) }, [id])
  return deal ? <DealModal deal={deal} onClose={onClose} onSaved={onSaved} /> : null
}
