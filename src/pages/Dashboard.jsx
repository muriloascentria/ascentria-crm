import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, DEMO } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtMoney } from '../lib/utils'
import { ActivityRow } from '../components/ActivityPanel'
import { RankingVendas } from '../components/MetasVendas'

export default function Dashboard() {
  const { profile, settings, stages, pipelines, users, label } = useApp()
  const [deals, setDeals] = useState([])
  const [acts, setActs] = useState([])
  const [pipelineId, setPipelineId] = useState(null)

  useEffect(() => {
    supabase.from('activities').select('*').eq('done', false).eq('assigned_to', profile.id).order('due_at').limit(8).then(({ data }) => setActs(data || []))
  }, [profile.id])
  useEffect(() => { if (!pipelineId && pipelines.length) setPipelineId(pipelines.find((p) => p.is_default)?.id || pipelines[0].id) }, [pipelines, pipelineId])

  const m = useMemo(() => {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const open = deals.filter((d) => d.status === 'open' && stages.find((x) => x.id === d.stage_id)?.role !== 'archived')
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
      {/* o Painel mostra o ranking de vendas do mês (pedido do Murilo em 14/11/2026) */}
      {!DEMO && <div style={{ marginBottom: 16 }}><RankingVendas /></div>}
    </>
  )
}
