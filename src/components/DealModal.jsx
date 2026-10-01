import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { ConfirmButton, CustomFieldsForm, Field, Modal, UserSelect } from './ui'
import { ActivityPanel } from './ActivityPanel'
import { fmtDateTime, fmtDate } from '../lib/utils'
import WhatsAppPanel from './WhatsAppPanel'
import { daysIn } from '../lib/wa'

/**
 * Modal de criação/edição de negócio.
 * props: deal (null para novo), defaults { pipeline_id, stage_id, contact_id }, onClose, onSaved,
 *        onMarkUnread (opcional: mostra "Marcar como não lida" nas 24h seguintes à última resposta do lead)
 */
export default function DealModal({ deal, defaults = {}, onClose, onSaved, onMarkUnread }) {
  const { stages, pipelines, profile, toast, isManager, users, waNumbers } = useApp()
  const [contacts, setContacts] = useState([])
  const [history, setHistory] = useState([])
  const [f, setF] = useState(() => ({
    title: '', value: '', contact_id: '', owner_id: profile.id, expected_close: '', custom: {}, lost_reason: '', wa_number_id: '',
    pipeline_id: defaults.pipeline_id || pipelines.find((p) => p.is_default)?.id || pipelines[0]?.id,
    stage_id: defaults.stage_id || '',
    ...defaults, ...(deal || {}),
  }))
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const pipeStages = stages.filter((s) => s.pipeline_id === f.pipeline_id)
  const curStage = stages.find((s) => s.id === f.stage_id)

  useEffect(() => {
    supabase.from('contacts').select('id,name,phone,wa_id').order('name').then(({ data }) => setContacts(data || []))
    if (deal?.id) supabase.from('deal_stage_history').select('*').eq('deal_id', deal.id).order('changed_at', { ascending: false }).then(({ data }) => setHistory(data || []))
  }, [deal?.id])

  useEffect(() => {
    if (!pipeStages.find((s) => s.id === f.stage_id) && pipeStages[0]) set('stage_id', pipeStages[0].id)
  }, [f.pipeline_id]) // eslint-disable-line

  const onContact = (id) => {
    set('contact_id', id)
  }

  const save = async (e) => {
    e.preventDefault()
    const payload = {
      title: f.title, value: Number(f.value || 0), pipeline_id: f.pipeline_id, stage_id: f.stage_id,
      contact_id: f.contact_id || null, owner_id: f.owner_id || null,
      expected_close: f.expected_close || null, custom: f.custom || {}, lost_reason: f.lost_reason || null,
      wa_number_id: f.wa_number_id || null,
    }
    const q = deal?.id ? supabase.from('deals').update(payload).eq('id', deal.id) : supabase.from('deals').insert(payload)
    const { error } = await q
    if (error) return toast(error.message, 'err')
    toast(deal?.id ? 'Negócio atualizado' : 'Negócio criado')
    onSaved?.(); onClose()
  }
  const remove = async () => {
    const { error } = await supabase.from('deals').delete().eq('id', deal.id)
    if (error) return toast(error.message, 'err')
    toast('Negócio excluído'); onSaved?.(); onClose()
  }
  const canMarkUnread = !!onMarkUnread && !!deal?.last_inbound_at && Date.now() - new Date(deal.last_inbound_at).getTime() < 86_400_000
  const stageName = (id) => stages.find((s) => s.id === id)?.name || '—'
  const userName = (id) => users.find((u) => u.id === id)?.full_name || ''
  const contato = contacts.find((c) => c.id === f.contact_id)
  const fone = contato?.wa_id ? '+' + contato.wa_id : contato?.phone || ''
  // troca de coluna direto do topo da conversa (salva na hora, sem precisar do botão Salvar)
  const moverPara = async (id) => {
    if (!id || id === f.stage_id) return
    const { error } = await supabase.from('deals').update({ stage_id: id }).eq('id', deal.id)
    if (error) return toast(error.message, 'err')
    set('stage_id', id)
    toast(`Card movido para ${stageName(id)}`)
    onSaved?.()
  }

  return (
    <Modal title={deal?.id ? 'Negócio' : 'Novo negócio'} onClose={onClose} wide={deal?.id ? (deal.contact_id ? 'x' : true) : false}
      footer={<>
        {deal?.id && (isManager || deal.owner_id === profile.id) && <ConfirmButton onConfirm={remove} className="btn danger" >Excluir</ConfirmButton>}
        {canMarkUnread && <button className="btn" type="button" onClick={onMarkUnread} title="Volta a bolinha vermelha no card (disponível por 24h após a resposta do lead)"><span className="unread-dot-inline" aria-hidden="true" />Marcar como não lida</button>}
        <span className="grow" />
        <button className="btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn primary" form="dealform">Salvar</button>
      </>}>
      {deal?.id && deal.contact_id && (
        <WhatsAppPanel contactId={deal.contact_id} deal={deal} onSent={onSaved} stageId={f.stage_id}
          onStageChanged={(id) => set('stage_id', id)}
          header={
            <div className="deal-head">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="deal-head-name">{contato?.name || f.title}</div>
                {fone && <div className="small muted">{fone}</div>}
              </div>
              <label className="small stack" style={{ gap: 2 }}>Coluna
                <select className="select" value={f.stage_id || ''} onChange={(e) => moverPara(e.target.value)} aria-label="Mover para a coluna" style={{ width: 'auto', minWidth: 170 }}>
                  {pipeStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
          } />
      )}
      {deal?.id && deal.contact_id && <h3 style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--border)' }}>Dados do negócio</h3>}
      <div className={deal?.id ? 'detail-grid' : ''}>
        <form id="dealform" onSubmit={save} className="stack" style={{ gap: 12 }}>
          <Field label="Título"><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} required autoFocus={!deal?.id} /></Field>
          <div className="grid2">
            <Field label="Valor (R$)"><input className="input" type="number" step="0.01" min="0" value={f.value} onChange={(e) => set('value', e.target.value)} /></Field>
            <Field label="Previsão de fechamento"><input className="input" type="date" value={f.expected_close || ''} onChange={(e) => set('expected_close', e.target.value)} /></Field>
          </div>
          <div className="grid2">
            <Field label="Funil">
              <select className="select" value={f.pipeline_id || ''} onChange={(e) => set('pipeline_id', e.target.value)}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Etapa">
              <select className="select" value={f.stage_id || ''} onChange={(e) => set('stage_id', e.target.value)} required>
                {pipeStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Contato">
            <select className="select" value={f.contact_id || ''} onChange={(e) => onContact(e.target.value)}>
              <option value="">—</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {deal?.id && curStage?.role && (
            <div className="small muted card" style={{ padding: '8px 10px', background: 'var(--surface-2)' }}>
              {curStage.role === 'day' && <>Na coluna <b>{curStage.name}</b> há {daysIn(deal.stage_entered_at)} dia(s){curStage.advance_after_days ? ` · avança sozinho após ${curStage.advance_after_days} dia(s) sem resposta` : ''}{deal.cycle > 1 ? ` · ${deal.cycle}ª passagem pela sequência` : ''}.</>}
              {curStage.role === 'responsive' && <>Lead respondeu — a sequência automática parou.</>}
              {curStage.role === 'archived' && <>{curStage.name}{deal.reactivate_at ? ` · volta sozinho para o Dia 1 em ${fmtDate(deal.reactivate_at)}` : ''}.</>}
              {curStage.role === 'reactivate' && <>Prazo de arquivamento venceu — hora de chamar de novo.</>}
            </div>
          )}
          <div className="grid2">
            <Field label="Responsável"><UserSelect value={f.owner_id} onChange={(v) => set('owner_id', v)} /></Field>
            {waNumbers.length > 0 && (
              <Field label="Número de WhatsApp que atende">
                <select className="select" value={f.wa_number_id || ''} onChange={(e) => set('wa_number_id', e.target.value)}>
                  <option value="">Padrão</option>
                  {waNumbers.filter((n) => n.active).map((n) => <option key={n.id} value={n.id}>{n.label} · {n.phone_display}</option>)}
                </select>
              </Field>
            )}
          </div>
          {curStage?.kind === 'lost' && <Field label="Motivo da perda"><input className="input" value={f.lost_reason || ''} onChange={(e) => set('lost_reason', e.target.value)} /></Field>}
          <CustomFieldsForm entity="deal" values={f.custom} onChange={(v) => set('custom', v)} />
        </form>
        {deal?.id && (
          <div className="stack" style={{ gap: 18 }}>
            <ActivityPanel link={{ deal_id: deal.id }} />
            {history.length > 0 && (
              <div className="stack">
                <h3>Histórico de etapas</h3>
                {history.map((h) => (
                  <div key={h.id} className="small muted">{fmtDateTime(h.changed_at)} — {stageName(h.from_stage_id)} → <b>{stageName(h.to_stage_id)}</b>{userName(h.changed_by) && ` · ${userName(h.changed_by)}`}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
