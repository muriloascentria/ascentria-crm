import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtMoney } from '../lib/utils'
import { ActivityRow } from '../components/ActivityPanel'

export default function Dashboard() {
  const { profile, settings, stages, pipelines, users, label } = useApp()
  const [deals, setDeals] = useState([])
  const [acts, setActs] = useState([])
  const [pipelineId, setPipelineId] = useState(null)

  useEffect(() => {
    supabase.from('deals').select('*').then(({ data }) => setDeals(data || []))
    supabase.from('activities').select('*').eq('done', false).eq('assigned_to', profile.id).order('due_at').limit(8).then(({ data }) => setActs(data || []))
  }, [profile.id])
  useEffect(() => { if (!pipelineId && pipelines.length) setPipelineId(pipelines.find((p) => p.is_default)?.id || pipelines[0].id) }, [pipelines, pipelineId])

  const m = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const open = deals.filter((d) => d.status === 'open')
    const wonMonth = deals.filter((d) => d.status === 'won' && new Date(d.closed_at) >= monthStart)
    const lostMonth = deals.filter((d) => d.status === 'lost' && new Date(d.closed_at) >= monthStart)
    const weighted = open.reduce((s, d) => s + Number(d.value) * ((stages.find((x) => x.id === d.stage_id)?.probability ?? 0) / 100), 0)
    const closed = wonMonth.length + lostMonth.length
    return {
      openCount: open.length, openValue: open.reduce((s, d) => s + Number(d.value), 0), weighted,
      wonValue: wonMonth.reduce((s, d) => s + Number(d.value), 0), wonCount: wonMonth.length,
      conv: closed ? Math.round((wonMonth.length / closed) * 100) : null,
      overdue: acts.filter((a) => a.due_at && new Date(a.due_at) < new Date()).length,
      inSequence: open.filter((d) => stages.find((x) => x.id === d.stage_id)?.role === 'day').length,
      toReactivate: open.filter((d) => stages.find((x) => x.id === d.stage_id)?.role === 'reactivate').length,
    }
  }, [deals, stages, acts])

  const pipeStages = stages.filter((s) => s.pipeline_id === pipelineId)
  const maxStage = Math.max(1, ...pipeStages.map((s) => deals.filter((d) => d.stage_id === s.id).length))

  const byOwner = useMemo(() => {
    const map = {}
    deals.filter((d) => d.status === 'open').forEach((d) => { map[d.owner_id] = (map[d.owner_id] || 0) + Number(d.value) })
    return Object.entries(map).map(([id, v]) => ({ name: users.find((u) => u.id === id)?.full_name || '—', v })).sort((a, b) => b.v - a.v)
  }, [deals, users])
  const maxOwner = Math.max(1, ...byOwner.map((o) => o.v))
  const cur = settings.currency

  const toggle = async (a) => { await supabase.from('activities').update({ done: true }).eq('id', a.id); setActs((x) => x.filter((y) => y.id !== a.id)) }

  return (
    <>
      <div className="page-head">
        <div><h1>Olá, {(profile.full_name || '').split(' ')[0]} 👋</h1><div className="muted small">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      </div>
      <div className="stats">
        <div className="stat"><div className="k">Negócios em aberto</div><div className="v">{m.openCount}</div><div className="small muted">{fmtMoney(m.openValue, cur)}</div></div>
        <div className="stat"><div className="k">Previsão ponderada</div><div className="v">{fmtMoney(m.weighted, cur)}</div><div className="small muted">valor × probabilidade da etapa</div></div>
        <div className="stat"><div className="k">Ganhos no mês</div><div className="v" style={{ color: 'var(--success)' }}>{fmtMoney(m.wonValue, cur)}</div><div className="small muted">{m.wonCount} negócio(s)</div></div>
        <div className="stat"><div className="k">Conversão no mês</div><div className="v">{m.conv === null ? '—' : m.conv + '%'}</div><div className="small muted">ganhos ÷ fechados</div></div>
        {stages.some((s) => s.role) && (<>
          <div className="stat"><div className="k">Em sequência (WhatsApp)</div><div className="v">{m.inSequence}</div><div className="small muted">aguardando resposta</div></div>
          <div className="stat"><div className="k">Leads para reativar</div><div className="v" style={{ color: m.toReactivate ? 'var(--accent)' : undefined }}>{m.toReactivate}</div><div className="small muted">arquivados há 4+ meses</div></div>
        </>)}
        <div className="stat"><div className="k">Atividades atrasadas</div><div className="v" style={{ color: m.overdue ? 'var(--danger)' : undefined }}>{m.overdue}</div><div className="small muted">suas pendências</div></div>
      </div>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card stack" style={{ gap: 12 }}>
          <div className="between"><h2>{label('pipeline')}</h2><Link to="/funil" className="small" style={{ color: 'var(--primary)' }}>abrir →</Link></div>
          {pipeStages.map((s) => {
            const n = deals.filter((d) => d.stage_id === s.id).length
            const v = deals.filter((d) => d.stage_id === s.id).reduce((a, d) => a + Number(d.value), 0)
            return (
              <div key={s.id}>
                <div className="between small"><span>{s.name}</span><span className="muted">{n} · {fmtMoney(v, cur)}</span></div>
                <div className="bar" style={{ '--stage-color': s.color }}><span style={{ width: `${(n / maxStage) * 100}%` }} /></div>
              </div>
            )
          })}
          {byOwner.length > 1 && (<>
            <h2 style={{ marginTop: 8 }}>Em aberto por responsável</h2>
            {byOwner.map((o) => (
              <div key={o.name}>
                <div className="between small"><span>{o.name}</span><span className="muted">{fmtMoney(o.v, cur)}</span></div>
                <div className="bar"><span style={{ width: `${(o.v / maxOwner) * 100}%` }} /></div>
              </div>
            ))}
          </>)}
        </div>
        <div className="card stack" style={{ gap: 12 }}>
          <div className="between"><h2>Suas próximas atividades</h2><Link to="/atividades" className="small" style={{ color: 'var(--primary)' }}>ver todas →</Link></div>
          {acts.length === 0 && <div className="muted small">Nenhuma pendência. 🎉</div>}
          <div className="timeline">{acts.map((a) => <ActivityRow key={a.id} a={a} onToggle={toggle} onEdit={() => {}} />)}</div>
        </div>
      </div>
    </>
  )
}
