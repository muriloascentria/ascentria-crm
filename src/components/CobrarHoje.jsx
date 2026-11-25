import { useEffect, useMemo, useState } from 'react'
import { supabase, invokeFn } from '../lib/supabase'
import { useApp } from '../lib/store'
import { Modal } from './ui'
import AbrirEm from './AbrirEm'
import { useMobile } from '../lib/useMobile'
import { waLink, abrirWhatsApp, firstName } from '../lib/manual'
import { splitParts } from '../lib/wa'

/**
 * Lista "Cobrar hoje" do funil Inadimplentes (pedido do Murilo em 25/11/2026), no mesmo jeito do
 * "Para contatar hoje" da Mentoria: diz qual mensagem de cobrança mandar para cada aluno hoje; ao confirmar
 * o envio, o card vai sozinho para a coluna certa.
 * A régua (dias contados do primeiro vencimento em aberto):
 *   D-5 e D0 → lembretes (a passagem D-5 → D0 → D+1 é feita pela rotina cobranca-run, de acordo com o ePLAT)
 *   Régua da Carmem (25/11): D+1 contato leve · D+4 aviso de pendência · D+8 consequências · D+12 proposta de acordo
 *   · D+15 prazo final · D+20 encerramento (Carmem)
 *   "Em negociação", "Acordo em dia" e o encaminhamento ao jurídico ficam manuais.
 */
export const PIPE_INADIMPLENTES = '1731d20c-e32a-4a67-a537-b8bc653c1e1f'
export const PIPE_COBRANCA = '2354ef40-0887-44f4-b584-e9c1c2bd2315'
export const PIPES_COBRANCA = [PIPE_INADIMPLENTES, PIPE_COBRANCA]
const DIA = 86_400_000
const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const br = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const diasAtraso = (d) => {
  const v = d.custom?.primeiro_vencimento || d.custom?.vencida_desde?.split('/').reverse().join('-')
  if (!v) return null
  return Math.round((Date.parse(hojeISO() + 'T12:00:00Z') - Date.parse(v + 'T12:00:00Z')) / DIA)
}

// mensagem (início do título da mensagem pronta) e coluna para onde o card vai depois de enviada
const COB = [
  { min: 20, msg: 'Cobrança 5', col: /Encerramento/ },
  { min: 15, msg: 'Cobrança 4', col: /Prazo final/ },
  { min: 12, msg: 'Negociação: proposta', col: /Proposta de acordo/ },
  { min: 8, msg: 'Cobrança 3', col: /Consequências/ },
  { min: 4, msg: 'Cobrança 2', col: /Aviso de pendência/ },
  { min: -Infinity, msg: 'Cobrança 1', col: /1º lembrete/ },
]
const pelaIdade = (dias) => COB.find((c) => (dias ?? 0) >= c.min)

/** Qual mensagem o card deve receber hoje e para onde vai depois. null = nada a enviar hoje. */
export function proximaCobranca(d, stages) {
  const col = stages.find((s) => s.id === d.stage_id)
  if (!col) return null
  const nome = col.name
  const enviouAqui = d.manual_sent_stage === d.stage_id
  const enviouHoje = d.manual_sent_at && new Date(d.manual_sent_at).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
  if (enviouHoje) return null
  const dias = diasAtraso(d)
  const st = (re) => stages.find((s) => re.test(s.name))
  // carteira (funil Cobrança): elegível à quitação ou à renovação → convite para a reunião de acompanhamento
  if (/^Agendar acompanhamento/.test(nome)) return enviouAqui ? null : { msg: 'Convite: reunião de acompanhamento', alvo: col }
  if (/^Vence em \d+ dias|D-[25]\b/.test(nome)) return enviouAqui ? null : { msg: 'Lembrete: vence em 5 dias', alvo: col }
  if (/D0/.test(nome)) return enviouAqui ? null : { msg: 'Lembrete: vence hoje', alvo: col }
  // quem entrou já atrasado (importado) começa no máximo pela mensagem de consequências (D+8): nunca pula etapas finais
  if (/^Parcela em atraso/.test(nome)) { const r = pelaIdade(Math.min(dias ?? 0, 11)); return { msg: r.msg, alvo: st(r.col) } }
  const idx = COB.findIndex((c) => c.col.test(nome))
  if (idx < 0) return null // negociação, acordo, regularizado, jurídico: manual
  if (!enviouAqui) return { msg: COB[idx].msg, alvo: col }
  const prox = COB[idx - 1] // a etapa seguinte da régua
  // entre uma cobrança e a próxima, pelo menos 3 dias (régua da Carmem: 2 a 4 dias entre envios)
  const desdeEnvio = d.manual_sent_at ? (Date.now() - Date.parse(d.manual_sent_at)) / DIA : 99
  if (prox && (dias ?? 0) >= prox.min && desdeEnvio >= 3) return { msg: prox.msg, alvo: st(prox.col) }
  return null
}

export default function CobrarHoje({ deals, onClose, onOpen, onRefresh }) {
  const mobile = useMobile()
  const { stages, toast, profile, settings } = useApp()
  const [quick, setQuick] = useState([])
  const [feitos, setFeitos] = useState({})
  useEffect(() => { supabase.from('quick_replies').select('title, body').eq('stage', 'cobranca').then(({ data }) => setQuick(data || [])) }, [])
  // ao abrir, confere as baixas no ePLAT antes de mostrar a lista (quem já pagou sai na hora)
  const [conferindo, setConferindo] = useState(true)
  useEffect(() => {
    let vivo = true
    invokeFn('cobranca-run', { body: {} }).then(async ({ error }) => {
      if (error) toast('Não consegui conferir as baixas no ePLAT agora: confira antes de cobrar', 'err')
      await onRefresh?.()
      if (vivo) setConferindo(false)
    })
    return () => { vivo = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pipeStages = useMemo(() => stages.filter((s) => PIPES_COBRANCA.includes(s.pipeline_id)), [stages])

  const lista = useMemo(() => deals.map((d) => ({ d, p: proximaCobranca(d, pipeStages) })).filter((x) => x.p)
    .sort((a, b) => (diasAtraso(b.d) ?? -9) - (diasAtraso(a.d) ?? -9)), [deals, pipeStages])

  const texto = (d, msg) => {
    const q = quick.find((x) => x.title.startsWith(msg))
    if (!q) return ''
    const limite = new Date(Date.now() + 5 * DIA - 3 * 3600_000).toISOString().slice(0, 10)
    return splitParts(q.body).join('\n\n')
      .replaceAll('{{primeiro_nome}}', firstName(d.contact?.name || d.title))
      .replaceAll('[VALOR]', brl(d.value))
      .replaceAll('[VENCIMENTO]', br(d.custom?.primeiro_vencimento) || d.custom?.vencida_desde || '')
      .replaceAll('[DATA LIMITE]', br(limite))
      .replaceAll('[CHAVE PIX]', String(settings?.pix_key || '').trim() || '[CHAVE PIX]')
  }
  const enviar = (d, p) => {
    const link = waLink(d.contact, texto(d, p.msg))
    if (!link) return toast('Contato sem telefone', 'err')
    abrirWhatsApp(link)
    setFeitos((f) => ({ ...f, [d.id]: 'aguardando' }))
  }
  const confirmar = async (d, p) => {
    const agora = new Date().toISOString()
    const { error } = await supabase.from('deals').update({ stage_id: p.alvo?.id || d.stage_id, manual_sent_stage: p.alvo?.id || d.stage_id, manual_sent_at: agora }).eq('id', d.id)
    if (error) return toast(error.message, 'err')
    await supabase.from('activities').insert({ type: 'whatsapp', title: `${p.msg} enviada pelo WhatsApp`, due_at: agora, done: true, done_at: agora, deal_id: d.id, contact_id: d.contact_id || null, assigned_to: profile?.id || null, created_by: profile?.id || null })
    setFeitos((f) => ({ ...f, [d.id]: 'enviado' }))
  }
  const pendentes = lista.filter(({ d }) => feitos[d.id] !== 'enviado')

  return (
    <Modal title={`💰 Cobrar hoje · ${pendentes.length}`} wide onClose={onClose}
      footer={<><AbrirEm /><span className="grow" /><button className="btn" onClick={onClose}>Fechar</button></>}>
      <details className="small muted" style={{ marginBottom: 10 }} open={!mobile}>
        <summary style={{ cursor: 'pointer' }}>Como funciona</summary>
        <b>Enviar</b> abre o WhatsApp com a mensagem de cobrança do dia já preenchida (nome, valor, vencimento e data-limite). Envie por lá e confirme em <b>Sim, enviei</b>: o card vai sozinho para a coluna da mensagem enviada.
        Régua: lembretes 5 dias antes (D-5) e no dia do vencimento; depois D+1 contato leve, D+4 aviso de pendência, D+8 consequências, D+12 proposta de acordo, D+15 prazo final e D+20 encerramento. Envie em dias úteis, das 9h às 18h. Negociação, acordo e jurídico continuam manuais. Antes de cobrar, confira se o pagamento não entrou sem baixa no ePLAT.
      </details>
      {conferindo && <div className="small muted" style={{ marginBottom: 8 }}>⏳ Conferindo as baixas no ePLAT…</div>}
      {lista.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Nenhuma cobrança para hoje. ✓</div>}
      <div className="stack" style={{ gap: 8 }}>
        {lista.map(({ d, p }) => {
          const feito = feitos[d.id]
          const dias = diasAtraso(d)
          const col = pipeStages.find((s) => s.id === d.stage_id)
          const txt = texto(d, p.msg)
          return (
            <div key={d.id} className="card" style={{ padding: 10, opacity: feito === 'enviado' ? 0.55 : 1, borderLeft: `3px solid ${(dias ?? 0) >= 15 ? '#7f1d1d' : (dias ?? 0) >= 8 ? '#dc2626' : (dias ?? 0) > 0 ? '#d97706' : '#2563eb'}` }}>
              <div className="between hoje-item" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div><b>{d.contact?.name || d.title}</b> <span className="chip" style={{ marginLeft: 4 }}>{p.msg}</span>
                    <span className="small muted" style={{ marginLeft: 6 }}>R$ {brl(d.value)} · {dias == null ? '' : dias < 0 ? `vence em ${-dias} dia(s)` : dias === 0 ? 'vence hoje' : `${dias} dia(s) de atraso`} · {col?.name}{p.alvo && p.alvo.id !== d.stage_id ? ` → ${p.alvo.name}` : ''}</span>
                  </div>
                  <div className="small muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{txt.length > 220 ? txt.slice(0, 220) + '…' : txt}</div>
                </div>
                <div className="stack hoje-acoes" style={{ gap: 4, flexShrink: 0 }}>
                  {feito === 'aguardando' ? <>
                    <span className="small" style={{ fontWeight: 600 }}>Enviou no WhatsApp?</span>
                    <button type="button" className="btn primary sm" onClick={() => confirmar(d, p)}>✓ Sim, enviei</button>
                    <button type="button" className="btn sm" onClick={() => setFeitos((f) => { const n = { ...f }; delete n[d.id]; return n })}>Ainda não</button>
                  </> : feito === 'enviado' ? <span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>✓ enviada</span>
                    : <button type="button" className="btn primary sm" disabled={conferindo} onClick={() => enviar(d, p)}>📲 Enviar</button>}
                  <button type="button" className="btn ghost sm" onClick={() => onOpen?.(d)}>Abrir card</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
