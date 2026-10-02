import { useState } from 'react'
import { invokeFn } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtDateTime } from '../lib/utils'
import { Field } from './ui'

// Mesmas opções da tela "Registro de Sessões 1:1" do Essência Plat (os relatórios de lá agrupam por esses textos)
const VENDEDORES = ['Adriana', 'Carmem', 'Carmem e Diego', 'Diego', 'Viviane']
const PRODUTOS = ['Mentoria Essência', 'Pós-Graduação']
const FORMATOS = ['Videochamada', 'Videochamada e WhatsApp', 'WhatsApp']
const PRESENCAS = ['Show', 'No-show']
const RESULTADOS = ['Vendido', 'Não vendido', 'Incompleto', 'Desqualificado']

const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || ''
const naLista = (nome, lista) => lista.find((o) => o.toLowerCase() === String(nome || '').toLowerCase()) || ''

/**
 * Aba "Registro da sessão" do card: a consultora registra a sessão 1:1 de venda.
 * Salva no card e também no Essência Plat (Registro de Sessões 1:1), pela função "plat-sessao".
 */
export default function SessaoRegistro({ deal, contato, onSaved, onStageChanged }) {
  const { profile, sellers, users, stages, toast } = useApp()
  const salvo = deal.sessao_registro || null
  const [info, setInfo] = useState({ em: deal.sessao_salva_em, por: deal.sessao_salva_por, plat: deal.plat_sessao_id })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [f, setF] = useState(() => {
    if (salvo) return { ...salvo }
    // primeira vez: já vem preenchido com o que o CRM sabe
    const vendedora = sellers.find((s) => s.id === deal.seller_id)?.name
    const gravacao = (Array.isArray(deal.meeting_files) ? deal.meeting_files : []).find((x) => x.kind === 'gravacao')?.url
    return {
      data: deal.meeting_date || new Date().toISOString().slice(0, 10),
      lead: contato?.name || deal.title || '',
      whatsapp: contato?.wa_id ? '+' + contato.wa_id : contato?.phone || '',
      vendedor: naLista(primeiroNome(vendedora), VENDEDORES) || naLista(primeiroNome(profile.full_name), VENDEDORES),
      produto: 'Mentoria Essência', upsell: false, formato: 'Videochamada', presenca: '', resultado: '',
      valor: '', objecao1: '', objecao2: '', observacoes: '', contrato: '', video: gravacao || '',
    }
  })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const opts = (lista, atual) => (
    <>
      <option value="">—</option>
      {[...lista, ...(atual && !lista.includes(atual) ? [atual] : [])].map((o) => <option key={o} value={o}>{o}</option>)}
    </>
  )

  const salvar = async (e) => {
    e.preventDefault()
    setBusy(true); setErro('')
    const { data, error } = await invokeFn('plat-sessao', { body: { deal_id: deal.id, dados: f } })
    setBusy(false)
    let msg = error?.message
    if (error) { try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* mantém */ } }
    if (!msg && data?.ok === false) msg = data.error
    if (msg) { setErro(msg); return toast(msg, 'err') }
    setInfo({ em: data.salvo_em, por: profile.id, plat: data.plat_id })
    toast(`Sessão salva no card e no Essência Plat (nº ${data.numero})` + (data.movido ? ` · card movido para ${data.movido}` : ''))
    if (data.movido) {
      const st = stages.find((s) => s.pipeline_id === deal.pipeline_id && s.name === data.movido)
      if (st) onStageChanged?.(st.id)
    }
    onSaved?.()
  }

  const quem = users.find((u) => u.id === info.por)?.full_name
  return (
    <form onSubmit={salvar} className="stack" style={{ gap: 12 }}>
      <div className="small muted">
        {info.em
          ? <>✓ Registrada em {fmtDateTime(info.em)}{quem ? ` por ${quem}` : ''}. Ao salvar de novo, a mesma linha é atualizada no Essência Plat.</>
          : <>Preencha depois da sessão de venda. Ao salvar, o registro fica aqui no card e entra também em <b>Registro de Sessões 1:1</b> no Essência Plat.</>}
      </div>
      <div className="grid2">
        <Field label="Data da sessão"><input className="input" type="date" value={f.data || ''} onChange={(e) => set('data', e.target.value)} required /></Field>
        <Field label="Vendedora">
          <select className="select" value={f.vendedor || ''} onChange={(e) => set('vendedor', e.target.value)} required>{opts(VENDEDORES, f.vendedor)}</select>
        </Field>
      </div>
      <div className="grid2">
        <Field label="Lead"><input className="input" value={f.lead || ''} onChange={(e) => set('lead', e.target.value)} required /></Field>
        <Field label="WhatsApp"><input className="input" value={f.whatsapp || ''} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
      </div>
      <div className="grid2">
        <Field label="Produto"><select className="select" value={f.produto || ''} onChange={(e) => set('produto', e.target.value)}>{opts(PRODUTOS, f.produto)}</select></Field>
        <Field label="Formato"><select className="select" value={f.formato || ''} onChange={(e) => set('formato', e.target.value)}>{opts(FORMATOS, f.formato)}</select></Field>
      </div>
      <div className="grid2">
        <Field label="Presença"><select className="select" value={f.presenca || ''} onChange={(e) => set('presenca', e.target.value)} required>{opts(PRESENCAS, f.presenca)}</select></Field>
        <Field label="Resultado"><select className="select" value={f.resultado || ''} onChange={(e) => set('resultado', e.target.value)} required={f.presenca === 'Show'}>{opts(RESULTADOS, f.resultado)}</select></Field>
      </div>
      <div className="grid2">
        <Field label="Valor"><input className="input" value={f.valor || ''} onChange={(e) => set('valor', e.target.value)} placeholder="Ex.: R$ 5.997,00" /></Field>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={!!f.upsell} onChange={(e) => set('upsell', e.target.checked)} /> Upsell (upgrade)
        </label>
      </div>
      <Field label="Objeção 1"><textarea className="input" rows={2} value={f.objecao1 || ''} onChange={(e) => set('objecao1', e.target.value)} /></Field>
      <Field label="Objeção 2"><textarea className="input" rows={2} value={f.objecao2 || ''} onChange={(e) => set('objecao2', e.target.value)} /></Field>
      <Field label="Observações"><textarea className="input" rows={3} value={f.observacoes || ''} onChange={(e) => set('observacoes', e.target.value)} /></Field>
      <div className="grid2">
        <Field label="Link do contrato"><input className="input" value={f.contrato || ''} onChange={(e) => set('contrato', e.target.value)} placeholder="https://..." /></Field>
        <Field label="Link da gravação"><input className="input" value={f.video || ''} onChange={(e) => set('video', e.target.value)} placeholder="https://..." /></Field>
      </div>
      <div className="small muted">
        Ao salvar, o card muda de coluna sozinho: <b>Vendido</b> → Fechou mentoria · <b>Não vendido</b> → Perdido apresentado · <b>No-show</b> → Remarcar.
      </div>
      {erro && <div className="small late">{erro}</div>}
      <div><button className="btn primary" disabled={busy}>{busy ? 'Salvando…' : info.em ? 'Atualizar registro' : 'Salvar registro'}</button></div>
    </form>
  )
}
