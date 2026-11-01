import { useEffect, useState } from 'react'
import { invokeFn, supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { waLink, abrirWhatsApp } from '../lib/manual'

/**
 * Termo de cancelamento (distrato) do card: ver o termo, enviar para assinatura por e-mail (Autentique)
 * e abrir o WhatsApp com a mensagem pronta avisando o lead. Mesmo fluxo do contrato.
 */
export default function TermoCancelamento({ deal, contato }) {
  const { toast } = useApp()
  const [d, setD] = useState(deal)
  const [busy, setBusy] = useState('')
  const [previa, setPrevia] = useState(null) // revisão antes de enviar: { texto, email, nome, signatario }
  const [conferi, setConferi] = useState(false)
  useEffect(() => { setD(deal) }, [deal])

  const recarregar = async () => {
    const { data } = await supabase.from('deals').select('distrato_doc_id, distrato_url, distrato_status, distrato_enviado_em, distrato_assinaturas, distrato_assinado_em, distrato_pdf_url').eq('id', deal.id).single()
    if (data) setD((x) => ({ ...x, ...data }))
  }
  // lê o termo do card ao abrir; enviado e ainda não assinado: confere na Autentique
  useEffect(() => {
    recarregar()
    if (deal.distrato_status === 'enviado') conferir(true)
  }, [deal.id]) // eslint-disable-line

  if (!d?.distrato_doc_id) return null
  const email = contato?.email || ''
  const nome = String(contato?.name || deal.title || '').trim().split(/\s+/)[0]

  // 1º passo: abre a revisão com o texto atual do termo (como no contrato)
  const revisar = async () => {
    if (!email) return toast('Cadastre o e-mail do lead no contato antes de enviar.', 'err')
    setBusy('previa')
    const { data, error } = await invokeFn('distrato', { body: { action: 'previa', deal_id: deal.id } })
    setBusy('')
    if (error || !data?.ok) return toast(data?.error || error?.message || 'Não consegui abrir o termo.', 'err')
    setConferi(false)
    setPrevia(data)
  }
  // 2º passo: depois de conferido, envia
  const enviar = async () => {
    setBusy('enviar')
    const { data, error } = await invokeFn('distrato', { body: { action: 'enviar', deal_id: deal.id } })
    setBusy('')
    if (error || !data?.ok) return toast(data?.error || error?.message || 'Não consegui enviar.', 'err')
    setPrevia(null)
    toast(`Termo enviado para assinatura: ${data.email}. Agora avise no WhatsApp.`)
    recarregar()
  }
  async function conferir(silencioso) {
    setBusy('status')
    const { data } = await invokeFn('distrato', { body: { action: 'status', deal_id: deal.id } })
    setBusy('')
    if (data?.ok) recarregar()
    else if (!silencioso) toast(data?.error || 'Não consegui conferir.', 'err')
  }
  const avisar = () => {
    const msg = [
      `Oi, ${nome}! Aqui é o Enfermeiro Murilo 🤓`,
      `Acabei de enviar para o seu e-mail (${email}) o *Termo de Cancelamento da Mentoria Essência*, pela Autentique, para assinatura eletrônica.`,
      'É só abrir o e-mail, conferir e assinar. Se não encontrar, dá uma olhadinha na caixa de spam 😉',
      'Foi um prazer ter você com a gente, e as portas continuam abertas. Qualquer dúvida, estou por aqui.',
    ].join('\n\n')
    const link = waLink(contato, msg)
    if (!link) return toast('Este contato não tem telefone cadastrado.', 'err')
    abrirWhatsApp(link)
    supabase.from('activities').insert({ type: 'whatsapp', title: 'Aviso do termo de cancelamento enviado (WhatsApp)', description: msg, deal_id: deal.id, contact_id: deal.contact_id || null, done: true, done_at: new Date().toISOString() }).then(() => {})
  }

  const st = d.distrato_status
  const quando = (iso) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
  const sigs = Array.isArray(d.distrato_assinaturas) ? d.distrato_assinaturas : []
  return (
    <div className="passo doc-pendente">
      <div className="passo-tit">📄 Termo de cancelamento {st === 'assinado' ? '· ✅ assinado' : st === 'enviado' ? '· ⏳ aguardando assinatura' : st === 'recusado' ? '· ❌ recusado' : '· pronto para enviar'}</div>
      <div className="small muted">
        {st === 'enviado' || st === 'assinado' || st === 'recusado'
          ? <>Enviado em {quando(d.distrato_enviado_em)} para {email}. {sigs.map((s) => `${s.nome || s.email}: ${s.assinado_em ? 'assinou ✓' : s.recusado_em ? 'recusou' : s.visto_em ? 'abriu, falta assinar' : 'falta assinar'}`).join(' · ')}</>
          : <>1. Toque em <b>Revisar e enviar por e-mail</b>, confira o termo e confirme (vai pela Autentique para você e para {email || 'o e-mail do lead'}). 2. Toque em <b>Avisar no WhatsApp</b>.</>}
      </div>
      {previa && (
        <div className="contrato-revisao stack" style={{ gap: 10, marginTop: 10 }}>
          <div className="passo-tit">🔎 Revise o termo antes de enviar</div>
          <div className="small">
            <div><b>Vai para assinatura de:</b></div>
            <div>• Murilo Pedroso Alves · {previa.signatario}</div>
            <div>• {previa.nome} · <b>{previa.email}</b></div>
          </div>
          <div className="termo-previa">{previa.texto}</div>
          <div className="small muted">Precisa mudar algo? Toque em <b>✏️ Editar o termo</b>, ajuste no Google Docs e depois toque em <b>↻ Atualizar</b> para ver a versão nova aqui.</div>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={conferi} onChange={(e) => setConferi(e.target.checked)} />
            <span>Conferi nome, CPF, valores, datas e o e-mail da lead.</span>
          </label>
          <div className="passo-acoes">
            <button type="button" className="btn primary" onClick={enviar} disabled={!conferi || !!busy}>{busy === 'enviar' ? 'Enviando…' : '✅ Confirmar e enviar por e-mail'}</button>
            <a className="btn" href={`https://docs.google.com/document/d/${d.distrato_doc_id}/edit`} target="_blank" rel="noreferrer">✏️ Editar o termo</a>
            <button type="button" className="btn ghost sm" onClick={revisar} disabled={!!busy}>{busy === 'previa' ? 'Atualizando…' : '↻ Atualizar'}</button>
            <button type="button" className="btn ghost sm" onClick={() => setPrevia(null)}>Voltar</button>
          </div>
        </div>
      )}
      {!previa && <div className="passo-acoes">
        {st !== 'assinado' && <button type="button" className={'btn' + (st ? '' : ' primary')} onClick={revisar} disabled={!!busy}>{busy === 'previa' ? 'Abrindo…' : st ? '📧 Revisar e enviar de novo' : '📧 Revisar e enviar por e-mail'}</button>}
        {(st === 'enviado' || st === 'recusado') && <button type="button" className="btn primary" onClick={avisar}>📲 Avisar no WhatsApp</button>}
        <a className="btn ghost sm" href={d.distrato_pdf_url || d.distrato_url || `https://docs.google.com/document/d/${d.distrato_doc_id}/edit`} target="_blank" rel="noreferrer">{d.distrato_pdf_url ? '📄 PDF assinado' : '📄 Ver / editar o termo'}</a>
        {st === 'enviado' && <button type="button" className="btn ghost sm" onClick={() => conferir(false)} disabled={!!busy}>{busy === 'status' ? 'Conferindo…' : '↻ Conferir assinatura'}</button>}
      </div>}
    </div>
  )
}
