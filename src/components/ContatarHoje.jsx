import { useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import { Modal } from './ui'
import AbrirEm from './AbrirEm'
import { fmtDate } from '../lib/utils'
import { useMobile } from '../lib/useMobile'
import { waLink, abrirWhatsApp, stageText, messageStage, devidos, marcarEnviado, marcarRespondeu } from '../lib/manual'

const POR_VEZ = 30

/**
 * Lista "Para contatar hoje": a sequência continua (Dia 1 → Dia 5), mas quem envia é a equipe.
 * Ordem: dos mais quentes para os mais frios — quem chegou (pediu contato) há menos tempo vem primeiro.
 */
const DIA = 86_400_000
const temperatura = (iso) => {
  const d = iso ? Math.floor((Date.now() - Date.parse(iso)) / DIA) : 999
  return d <= 3 ? { k: 'quente', t: '🔥 Quentes · chegaram nos últimos 3 dias', c: '#c0392b' }
    : d <= 14 ? { k: 'morno', t: '🌤 Mornos · chegaram há 4 a 14 dias', c: '#b7791f' }
    : { k: 'frio', t: '❄️ Frios · chegaram há mais de 14 dias', c: '#2b6cb0' }
}
export default function ContatarHoje({ deals, onClose, onChanged, onOpen }) {
  const mobile = useMobile()
  const { stages, toast, profile } = useApp()
  const [feitos, setFeitos] = useState({}) // dealId → 'enviado' | 'respondeu'
  const [limite, setLimite] = useState(POR_VEZ)
  const lista = useMemo(() => {
    return devidos(deals, stages).sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
  }, [deals, stages])
  const pendentes = lista.filter((d) => !feitos[d.id] || feitos[d.id] === 'aguardando')
  // primeiros contatos (Dia 1) já feitos hoje, para não passar do limite seguro do número
  const dia1 = stages.filter((s) => s.role === 'day').sort((a, b) => a.position - b.position)[0]
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0)
  const novosHoje = deals.filter((d) => d.manual_sent_stage === dia1?.id && d.manual_sent_at && Date.parse(d.manual_sent_at) >= inicioHoje.getTime() && !feitos[d.id]).length
    + lista.filter((d) => feitos[d.id] === 'enviado' && messageStage(d, stages)?.id === dia1?.id).length

  const enviar = async (d) => {
    const st = messageStage(d, stages)
    const link = waLink(d.contact, stageText(st, d.contact?.name))
    if (!link) return toast('Contato sem telefone', 'err')
    abrirWhatsApp(link)
    setFeitos((f) => ({ ...f, [d.id]: 'aguardando' }))
  }
  const confirmar = async (d) => {
    try {
      await marcarEnviado(d, stages, profile?.id)
      setFeitos((f) => ({ ...f, [d.id]: 'enviado' }))
      onChanged?.()
    } catch (e) { toast(e.message, 'err') }
  }
  const naoEnviou = (d) => setFeitos((f) => { const n = { ...f }; delete n[d.id]; return n })
  const respondeu = async (d) => {
    try { await marcarRespondeu(d, stages); setFeitos((f) => ({ ...f, [d.id]: 'respondeu' })); onChanged?.() } catch (e) { toast(e.message, 'err') }
  }
  const dias = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : null)

  return (
    <Modal title={`📲 Para contatar hoje · ${pendentes.length}`} wide onClose={onClose}
      footer={<><AbrirEm /><span className="small muted grow" style={{ marginLeft: mobile ? 0 : 12 }}>Feitos agora: {Object.values(feitos).filter((v) => v !== 'aguardando').length} · <b style={{ color: novosHoje >= 30 ? 'var(--danger)' : undefined }}>primeiros contatos hoje: {novosHoje}</b> (sugestão: até 20–30)</span><button className="btn" onClick={onClose}>Fechar</button></>}>
      <details className="small muted" style={{ marginBottom: 10 }} open={!mobile}>
        <summary style={{ cursor: 'pointer' }}>Como funciona</summary>
        <b>Enviar</b> abre o WhatsApp (o app do computador ou o WhatsApp Web, conforme o "Abrir em" lá embaixo) com a mensagem do dia pronta; envie por lá e confirme aqui em <b>Sim, enviei</b>; no dia seguinte o card passa sozinho para o próximo Dia.
        Quando o lead responder, clique em <b>Respondeu</b>. Se ao abrir a conversa você vir que ele já respondeu, não envie a mensagem do dia: clique em <b>Não: tinha respondido</b>. Ficam fora da lista quem pediu para sair e a lista antiga sem autorização.
        <br />A lista vem dos <b>mais quentes</b> (pediram contato há pouco) para os <b>mais frios</b>. Para proteger o número, evite passar de uns 20–30 primeiros contatos (Dia 1) por dia.
      </details>
      {lista.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Ninguém para contatar agora. ✓</div>}
      <div className="stack" style={{ gap: 8 }}>
        {lista.slice(0, limite).map((d, i, arr) => {
          const temp = temperatura(d.created_at)
          const novoGrupo = i === 0 || temperatura(arr[i - 1].created_at).k !== temp.k
          const st = messageStage(d, stages)
          const col = stages.find((s) => s.id === d.stage_id)
          const txt = stageText(st, d.contact?.name)
          const feito = feitos[d.id]
          const idade = dias(d.created_at)
          return (
            <div key={d.id} className="stack" style={{ gap: 6 }}>
            {novoGrupo && <div className="small" style={{ fontWeight: 700, color: temp.c, marginTop: i ? 8 : 0 }}>{temp.t}</div>}
            <div className="card" style={{ padding: 10, opacity: feito && feito !== 'aguardando' ? 0.55 : 1, borderLeft: `3px solid ${temp.c}` }}>
              <div className="between hoje-item" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div><b>{d.contact?.name || d.title}</b> <span className="chip" style={{ marginLeft: 4 }}>{col?.role === 'inbox' ? `Recebidos → ${st?.name}` : st?.name}</span>
                    {idade !== null && <span className="small muted" style={{ marginLeft: 6 }}>chegou {idade === 0 ? 'hoje' : idade === 1 ? 'ontem' : `há ${idade} dias`}{d.created_at ? ` (${fmtDate(d.created_at)})` : ''}</span>}
                  </div>
                  <div className="small muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{txt.length > 180 ? txt.slice(0, 180) + '…' : txt}</div>
                </div>
                <div className="stack hoje-acoes" style={{ gap: 4, flexShrink: 0 }}>
                  {feito === 'aguardando' ? <>
                    <span className="small" style={{ fontWeight: 600 }}>Enviou no WhatsApp?</span>
                    <button type="button" className="btn primary sm" onClick={() => confirmar(d)}>✓ Sim, enviei</button>
                    <button type="button" className="btn sm" onClick={() => respondeu(d)} title="Ao abrir a conversa você viu que o lead tinha respondido: vai para Responsivo">💬 Não: tinha respondido</button>
                    <button type="button" className="btn sm" onClick={() => naoEnviou(d)}>Ainda não</button>
                  </> : feito ? <span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>{feito === 'enviado' ? '✓ enviada' : '✓ respondeu'}</span> : <>
                    <button type="button" className="btn primary sm" onClick={() => enviar(d)}>📲 Enviar</button>
                    <button type="button" className="btn sm" onClick={() => respondeu(d)} title="O lead respondeu: vai para Responsivo">✅ Respondeu</button>
                  </>}
                  <button type="button" className="btn ghost sm" onClick={() => onOpen?.(d)}>Abrir card</button>
                </div>
              </div>
            </div>
            </div>
          )
        })}
      </div>
      {lista.length > limite && (
        <button type="button" className="btn ghost" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }} onClick={() => setLimite((n) => n + POR_VEZ)}>
          Mostrar mais {Math.min(POR_VEZ, lista.length - limite)} de {lista.length - limite}
        </button>
      )}
    </Modal>
  )
}
