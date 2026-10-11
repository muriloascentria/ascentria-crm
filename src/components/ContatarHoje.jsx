import { useMemo, useState } from 'react'
import { useApp } from '../lib/store'
import { Modal } from './ui'
import { fmtDate } from '../lib/utils'
import { waLink, stageText, messageStage, devidos, marcarEnviado, marcarRespondeu } from '../lib/manual'

const POR_VEZ = 30

/**
 * Lista "Para contatar hoje": a sequência continua (Dia 1 → Dia 5), mas quem envia é a equipe.
 * Ordem: quem já está na sequência (Dia 5 → Dia 2) e depois os novos de Recebidos, mais recentes primeiro.
 */
export default function ContatarHoje({ deals, onClose, onChanged, onOpen }) {
  const { stages, toast, profile } = useApp()
  const [feitos, setFeitos] = useState({}) // dealId → 'enviado' | 'respondeu'
  const [limite, setLimite] = useState(POR_VEZ)
  const lista = useMemo(() => {
    const pos = (d) => stages.find((s) => s.id === d.stage_id)
    return devidos(deals, stages).sort((a, b) => {
      const sa = pos(a), sb = pos(b)
      const da = sa?.role === 'day' ? sa.position : -1, db = sb?.role === 'day' ? sb.position : -1
      if (da !== db) return db - da
      return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)
    })
  }, [deals, stages])
  const pendentes = lista.filter((d) => !feitos[d.id])

  const enviar = async (d) => {
    const st = messageStage(d, stages)
    const link = waLink(d.contact, stageText(st, d.contact?.name))
    if (!link) return toast('Contato sem telefone', 'err')
    window.open(link, '_blank', 'noopener')
    try {
      await marcarEnviado(d, stages, profile?.id)
      setFeitos((f) => ({ ...f, [d.id]: 'enviado' }))
      onChanged?.()
    } catch (e) { toast(e.message, 'err') }
  }
  const respondeu = async (d) => {
    try { await marcarRespondeu(d, stages); setFeitos((f) => ({ ...f, [d.id]: 'respondeu' })); onChanged?.() } catch (e) { toast(e.message, 'err') }
  }
  const dias = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : null)

  return (
    <Modal title={`📲 Para contatar hoje · ${pendentes.length}`} wide onClose={onClose}
      footer={<><span className="small muted grow">Feitos agora: {Object.keys(feitos).length}</span><button className="btn" onClick={onClose}>Fechar</button></>}>
      <div className="small muted" style={{ marginBottom: 10 }}>
        <b>Enviar</b> abre o WhatsApp com a mensagem do dia pronta e marca como enviada; no dia seguinte o card passa sozinho para o próximo Dia.
        Quando o lead responder, clique em <b>Respondeu</b>. Ficam fora da lista quem pediu para sair e a lista antiga sem autorização.
        <br />Para proteger o número, comece pelos mais recentes e evite passar de uns 30 primeiros contatos novos por dia.
      </div>
      {lista.length === 0 && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Ninguém para contatar agora. ✓</div>}
      <div className="stack" style={{ gap: 8 }}>
        {lista.slice(0, limite).map((d) => {
          const st = messageStage(d, stages)
          const col = stages.find((s) => s.id === d.stage_id)
          const txt = stageText(st, d.contact?.name)
          const feito = feitos[d.id]
          const idade = dias(d.created_at)
          return (
            <div key={d.id} className="card" style={{ padding: 10, opacity: feito ? 0.55 : 1 }}>
              <div className="between" style={{ gap: 8, alignItems: 'flex-start' }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div><b>{d.contact?.name || d.title}</b> <span className="chip" style={{ marginLeft: 4 }}>{col?.role === 'inbox' ? `Recebidos → ${st?.name}` : st?.name}</span>
                    {idade !== null && <span className="small muted" style={{ marginLeft: 6 }}>chegou {idade === 0 ? 'hoje' : idade === 1 ? 'ontem' : `há ${idade} dias`}{d.created_at ? ` (${fmtDate(d.created_at)})` : ''}</span>}
                  </div>
                  <div className="small muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{txt.length > 180 ? txt.slice(0, 180) + '…' : txt}</div>
                </div>
                <div className="stack" style={{ gap: 4, flexShrink: 0 }}>
                  {feito ? <span className="small" style={{ color: 'var(--success)', fontWeight: 600 }}>{feito === 'enviado' ? '✓ enviada' : '✓ respondeu'}</span> : <>
                    <button type="button" className="btn primary sm" onClick={() => enviar(d)}>📲 Enviar</button>
                    <button type="button" className="btn sm" onClick={() => respondeu(d)} title="O lead respondeu: vai para Responsivo">✅ Respondeu</button>
                  </>}
                  <button type="button" className="btn ghost sm" onClick={() => onOpen?.(d)}>Abrir card</button>
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
