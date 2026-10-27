import { useEffect, useState } from 'react'
import { invokeFn, supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { fmtDateTime } from '../lib/utils'
import { Field, Modal } from './ui'

const FORMAS = ['Pix', 'Pix + cartão de crédito', 'Cartão de crédito', 'Boleto', 'Pix + boleto']
const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
const maisUmAno = (ym) => `${Number(ym.slice(0, 4)) + 1}${ym.slice(4)}`
const num = (t) => {
  let s = String(t ?? '').replace(/[^\d,.-]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const brl = (v) => (v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))

async function chamar(body) {
  const { data, error } = await invokeFn('contrato', { body })
  let msg = error?.message
  if (error) { try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* mantém */ } }
  if (!msg && data?.ok === false) msg = data.error
  if (msg) throw new Error(msg)
  return data
}

function Copiar({ label, valor }) {
  const [ok, setOk] = useState(false)
  if (!valor) return null
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span className="small muted" style={{ minWidth: 92 }}>{label}</span>
      <code className="small" style={{ background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 6 }}>{valor}</code>
      <button type="button" className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(valor); setOk(true); setTimeout(() => setOk(false), 1500) }}>{ok ? '✓ copiado' : 'Copiar'}</button>
    </div>
  )
}

/**
 * Contrato da Mentoria Essência: a vendedora preenche os dados do lead, o CRM cria o contrato no Google Docs
 * (Drive dela), gera o PDF e envia para assinatura pela Autentique (Murilo + lead, por e-mail).
 * A Autentique avisa o CRM a cada assinatura; quando todos assinam, o card fica "assinado".
 */
export default function ContratoModal({ deal, contato, onClose, onSaved }) { // contato opcional: { name }
  const { settings, toast } = useApp()
  const signatario = settings?.contract_signer_email || 'murilo@ascentria.com.br'
  const salvo = deal.contrato || null
  const [estado, setEstado] = useState({ url: deal.contrato_url, status: deal.contrato_status, em: deal.contrato_gerado_em, assinaturas: deal.contrato_assinaturas || null, pdf: deal.contrato_pdf_url || null, autentique: !!deal.contrato_autentique_id })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const [f, setF] = useState(() => {
    const hoje = hojeISO()
    return {
      nome: contato?.name || deal.title || '', email: '', cpf: '', endereco: '', bairro: '', cidade_uf: '',
      valor_total: 'R$ 11.997,00', forma_pagamento: 'Pix + cartão de crédito', entrada: '', num_parcelas: '', valor_parcela: '', vencimentos: '', clausula_especial: '',
      data: hoje, vigencia_inicio: hoje.slice(0, 7), vigencia_fim: maisUmAno(hoje.slice(0, 7)),
      ...(salvo || {}),
    }
  })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  // nome e e-mail do lead vêm do contato, se já estiverem cadastrados
  useEffect(() => {
    if (!deal.contact_id) return
    supabase.from('contacts').select('name, email').eq('id', deal.contact_id).single().then(({ data }) => {
      if (!data) return
      setF((x) => ({ ...x, email: x.email || data.email || '', nome: salvo?.nome || x.nome || data.name || '' }))
    })
  }, [deal.contact_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // conta das parcelas: (total − entrada) ÷ parcelas
  const total = num(f.valor_total), entrada = num(f.entrada) ?? 0, nParc = Number(String(f.num_parcelas).replace(/\D/g, '')) || 0
  const sugestaoParcela = total != null && nParc > 0 ? Math.round(((total - entrada) / nParc) * 100) / 100 : null
  // número de parcelas em branco, mas com o valor da parcela: deduz pela conta (ex.: 9.497 ÷ 949,70 = 10)
  const vParc = num(f.valor_parcela)
  const restante = total != null ? Math.round((total - entrada) * 100) / 100 : null
  // à vista: forma de pagamento "à vista" ou nº de parcelas digitado como 0 → 0 parcelas é permitido
  const aVista = /vista/i.test(String(f.forma_pagamento || '')) || String(f.num_parcelas ?? '').trim() === '0'
  const nDeduzido = !nParc && vParc && restante > 0 && Math.abs(restante / vParc - Math.round(restante / vParc)) < 0.01 ? Math.round(restante / vParc) : null
  const parcelaConfere = sugestaoParcela == null || !f.valor_parcela || Math.abs((num(f.valor_parcela) ?? 0) - sugestaoParcela) < 0.05

  // 1º passo: confere os dados e mostra o resumo para a consultora revisar com o lead (nada é enviado ainda)
  const [revisar, setRevisar] = useState(null)
  const [conferi, setConferi] = useState(false)
  const gerar = (e) => {
    e.preventDefault()
    setErro('')
    // número de parcelas: obrigatório quando sobra valor depois da entrada (sem ele o contrato saía com "0 parcelas")
    const n = nParc || nDeduzido || 0
    if (total == null) return setErro('Informe o valor total.')
    if (restante > 0.01 && !n && !aVista) return setErro('Informe o número de parcelas (o valor total é maior que a entrada). Se o pagamento for à vista, coloque 0.')
    // parcela em branco: usa a conta (total − entrada ÷ parcelas)
    const dados = { ...f, num_parcelas: n ? String(n) : (aVista ? '0' : ''), valor_parcela: f.valor_parcela || (n ? brl(Math.round((restante / n) * 100) / 100) : '') }
    const avisos = []
    const cpf = String(f.cpf || '').replace(/\D/g, '')
    if (cpf.length !== 11) avisos.push(`O CPF tem ${cpf.length} números (o certo são 11).`)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(f.email || '').trim())) avisos.push('O e-mail parece incompleto: é para ele que vai o pedido de assinatura.')
    const vP = num(dados.valor_parcela)
    if (n && vP != null && Math.abs(entrada + n * vP - total) > 1) avisos.push(`A conta não fecha: entrada ${brl(entrada)} + ${n} × ${brl(vP)} = ${brl(entrada + n * vP)}, mas o total é ${brl(total)}.`)
    if (!/\d{5}-?\d{3}/.test(`${f.endereco} ${f.bairro} ${f.cidade_uf}`)) avisos.push('Não achei o CEP no endereço (confira se precisa).')
    if (!String(f.vencimentos || '').trim() && n) avisos.push('Os vencimentos das parcelas estão em branco.')
    setConferi(false)
    setRevisar({ dados, n, avisos })
  }
  // 2º passo: depois de conferir, gera o contrato e envia para assinatura
  const enviar = async () => {
    if (!revisar) return
    setErro('')
    setBusy(true)
    try {
      const { dados } = revisar
      const r = await chamar({ action: 'gerar', deal_id: deal.id, dados })
      // e-mail do lead fica salvo no contato para as próximas vezes
      if (f.email && deal.contact_id) await supabase.from('contacts').update({ email: f.email.trim() }).eq('id', deal.contact_id)
      setEstado({ url: r.url, status: r.enviado ? 'enviado' : 'gerado', em: new Date().toISOString(), assinaturas: r.assinaturas || null, pdf: null, autentique: !!r.enviado })
      if (r.enviado) toast('Contrato enviado para assinatura (Murilo e lead)')
      else if (r.erro_envio) { setErro('O contrato foi gerado, mas não foi enviado para assinatura: ' + r.erro_envio); toast('Contrato gerado, mas o envio falhou', 'err') }
      else toast('Contrato gerado no Google Docs')
      setF(dados)
      setRevisar(null)
      onSaved?.()
    } catch (err) {
      setErro(err.message); toast(err.message, 'err')
    } finally { setBusy(false) }
  }
  const atualizar = async () => {
    setBusy(true)
    try {
      const r = await chamar({ action: 'status', deal_id: deal.id })
      setEstado((s) => ({ ...s, status: r.status, assinaturas: r.assinaturas, pdf: r.pdf || s.pdf }))
      onSaved?.()
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }
  const marcarAssinado = async (desfazer) => {
    setBusy(true)
    try {
      await chamar({ action: 'assinado', deal_id: deal.id, desfazer })
      setEstado((s) => ({ ...s, status: desfazer ? (s.autentique ? 'enviado' : 'gerado') : 'assinado' }))
      toast(desfazer ? 'Contrato voltou para "aguardando assinatura"' : 'Contrato marcado como assinado')
      onSaved?.()
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }
  const titulo = estado.status === 'assinado' ? '✅ Contrato assinado por todos'
    : estado.status === 'recusado' ? '⛔ O contrato foi recusado'
    : estado.status === 'enviado' ? '📨 Enviado para assinatura — aguardando'
    : '✍️ Contrato gerado — ainda não enviado para assinatura'

  return (
    <Modal stack wide title="📄 Contrato — Mentoria Essência" onClose={onClose}
      footer={<>
        <span className="grow" />
        {revisar ? (
          <>
            <button className="btn" type="button" onClick={() => setRevisar(null)} disabled={busy}>← Voltar e corrigir</button>
            <button className="btn primary" type="button" onClick={enviar} disabled={busy || !conferi}>
              {busy ? 'Enviando…' : '✓ Está tudo certo: enviar para assinatura'}
            </button>
          </>
        ) : (
          <>
            <button className="btn" type="button" onClick={onClose}>Fechar</button>
            <button className="btn primary" form="contratoform" disabled={busy || estado.status === 'assinado'}>
              {estado.url ? 'Revisar e reenviar' : 'Revisar antes de enviar'}
            </button>
          </>
        )}
      </>}>
      {estado.url && (
        <div className="card stack" style={{ gap: 8, marginBottom: 14, background: 'var(--surface-2)' }}>
          <div className="between wrap" style={{ gap: 8 }}>
            <div>
              <b>{titulo}</b>
              {estado.em && <div className="small muted">Gerado em {fmtDateTime(estado.em)}</div>}
            </div>
            <div className="row" style={{ gap: 6 }}>
              {estado.pdf && <a className="btn sm primary" href={estado.pdf} target="_blank" rel="noreferrer">PDF assinado ↗</a>}
              {deal.contrato_arquivo_url && <a className="btn sm" href={deal.contrato_arquivo_url} target="_blank" rel="noreferrer" title="Cópia na pasta Contratos_Assinados › Mentoria_Essência">📁 Na pasta de assinados ↗</a>}
              <a className="btn sm" href={estado.url} target="_blank" rel="noreferrer">Ver contrato ↗</a>
              {estado.autentique && estado.status !== 'assinado' && <button type="button" className="btn ghost sm" onClick={atualizar} disabled={busy}>↻ Atualizar</button>}
            </div>
          </div>
          {estado.autentique && (estado.assinaturas || []).map((a, i) => (
            <div key={i} className="small">
              {a.assinado_em ? '✅' : a.recusado_em ? '⛔' : a.visto_em ? '👀' : '⏳'} <b>{a.nome || a.email}</b> <span className="muted">{a.email}</span>
              {' — '}{a.assinado_em ? `assinou em ${fmtDateTime(a.assinado_em)}` : a.recusado_em ? `recusou em ${fmtDateTime(a.recusado_em)}` : a.visto_em ? 'abriu, ainda não assinou' : 'aguardando'}
            </div>
          ))}
          {estado.status === 'enviado' && <div className="small muted">O e-mail da Autentique já foi para os dois. Este quadro se atualiza sozinho quando cada um assinar.</div>}
          {!estado.autentique && estado.status !== 'assinado' && (
            <>
              <div className="small">Para pedir as assinaturas pelo Google: no contrato, <b>Ferramentas → Assinatura eletrônica → Solicitar assinatura</b>, com os dois e-mails abaixo.</div>
              <Copiar label="Signatário 1" valor={signatario} />
              <Copiar label="Signatário 2" valor={f.email} />
              <div><button type="button" className="btn ghost sm" onClick={() => marcarAssinado(false)} disabled={busy}>✓ Marcar como assinado</button></div>
            </>
          )}
          {estado.status === 'assinado' && !estado.autentique && <div><button type="button" className="btn ghost sm" onClick={() => marcarAssinado(true)} disabled={busy}>Desfazer "assinado"</button></div>}
          {estado.url && estado.status !== 'assinado' && <div className="small muted">Precisa corrigir algo? Ajuste os campos abaixo e clique em "Corrigir e reenviar": o envio anterior é cancelado e um novo vai para os dois.</div>}
        </div>
      )}
      {revisar && (() => {
        const d = revisar.dados
        const mes = (ym) => { const [y, m] = String(ym || '').split('-'); return m ? `${m}/${y}` : '—' }
        const linhas = [
          ['Nome completo', d.nome], ['CPF', d.cpf], ['E-mail (assinatura)', d.email],
          ['Endereço', d.endereco], ['Bairro', d.bairro], ['Cidade - UF', d.cidade_uf],
          ['Valor total', brl(num(d.valor_total))], ['Forma de pagamento', d.forma_pagamento],
          ['Entrada', d.entrada ? brl(num(d.entrada)) : 'sem entrada'],
          ['Parcelas', revisar.n ? `${revisar.n} parcela(s) de ${brl(num(d.valor_parcela))}` : '0 parcelas (pagamento à vista)'],
          ['Vencimentos', d.vencimentos || '—'],
          ['Data do contrato', String(d.data || '').split('-').reverse().join('/')], ['Vigência', `${mes(d.vigencia_inicio)} a ${mes(d.vigencia_fim)}`],
          ['Cláusula especial', d.clausula_especial || 'nenhuma'],
        ]
        return (
          <div className="stack" style={{ gap: 10 }}>
            <div className="passo" style={{ margin: 0 }}>
              <div className="passo-tit">🔎 Confira os dados antes de enviar</div>
              <div className="small">Leia com o lead, campo por campo. É exatamente isto que vai para o contrato e para a assinatura.</div>
            </div>
            <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {linhas.map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: '1px solid var(--border, #e5e5e5)' }}>
                    <td style={{ padding: '6px 8px 6px 0', color: 'var(--muted)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                    <td style={{ padding: '6px 0', fontWeight: 600, wordBreak: 'break-word' }}>{v || <span className="late">— em branco —</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {revisar.avisos.length > 0 && (
              <div className="card" style={{ background: '#fff4e5', borderColor: '#f0b35b' }}>
                <b>⚠ Atenção</b>
                <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{revisar.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            )}
            <label className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 600 }}>
              <input type="checkbox" checked={conferi} onChange={(e) => setConferi(e.target.checked)} />
              Conferi todos os dados e estão corretos
            </label>
            {erro && <div className="small late">{erro}</div>}
          </div>
        )
      })()}
      <form id="contratoform" onSubmit={gerar} className="stack" style={{ gap: 12, display: revisar ? 'none' : undefined }}>
        <div className="small muted">Os campos abaixo entram no modelo do contrato. Valores por extenso, datas e vigência são escritos automaticamente.</div>
        <h3 style={{ margin: '4px 0 0' }}>Contratante</h3>
        <div className="grid2">
          <Field label="Nome completo"><input className="input" value={f.nome} onChange={(e) => set('nome', e.target.value)} required /></Field>
          <Field label="E-mail (para a assinatura)"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></Field>
        </div>
        <div className="grid2">
          <Field label="CPF"><input className="input" value={f.cpf} onChange={(e) => set('cpf', e.target.value)} placeholder="000.000.000-00" required /></Field>
          <Field label="Cidade - UF"><input className="input" value={f.cidade_uf} onChange={(e) => set('cidade_uf', e.target.value)} placeholder="Curitiba - PR" required /></Field>
        </div>
        <div className="grid2">
          <Field label="Endereço (rua e número)"><input className="input" value={f.endereco} onChange={(e) => set('endereco', e.target.value)} placeholder="Rua Exemplo, 123, apto 45" required /></Field>
          <Field label="Bairro"><input className="input" value={f.bairro} onChange={(e) => set('bairro', e.target.value)} required /></Field>
        </div>

        <h3 style={{ margin: '8px 0 0' }}>Valor e pagamento</h3>
        <div className="grid2">
          <Field label="Valor total"><input className="input" value={f.valor_total} onChange={(e) => set('valor_total', e.target.value)} required /></Field>
          <Field label="Forma de pagamento">
            <input className="input" list="formas-pagto" value={f.forma_pagamento} onChange={(e) => set('forma_pagamento', e.target.value)} required />
            <datalist id="formas-pagto">{FORMAS.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
        </div>
        <div className="grid2">
          <Field label="Entrada (via Pix, na data de hoje)"><input className="input" value={f.entrada} onChange={(e) => set('entrada', e.target.value)} placeholder="R$ 1.997,00" /></Field>
          <Field label="Número de parcelas" hint={nDeduzido ? `Pela conta: ${nDeduzido} parcelas` : (aVista ? 'À vista: 0 parcelas' : restante > 0.01 && !nParc ? '⚠ Obrigatório quando há valor depois da entrada (à vista: coloque 0)' : '')}>
            <div className="row" style={{ gap: 6 }}>
              <input className="input grow" inputMode="numeric" value={f.num_parcelas} onChange={(e) => set('num_parcelas', e.target.value)} placeholder="10" />
              {nDeduzido && <button type="button" className="btn ghost sm" onClick={() => set('num_parcelas', String(nDeduzido))}>usar</button>}
            </div>
          </Field>
        </div>
        <div className="grid2">
          <Field label="Valor de cada parcela" hint={sugestaoParcela != null ? (parcelaConfere ? `Pela conta: ${brl(sugestaoParcela)}` : `⚠ Pela conta daria ${brl(sugestaoParcela)} (total − entrada ÷ parcelas)`) : ''}>
            <div className="row" style={{ gap: 6 }}>
              <input className="input grow" value={f.valor_parcela} onChange={(e) => set('valor_parcela', e.target.value)} placeholder="R$ 1.000,00" />
              {sugestaoParcela != null && (!f.valor_parcela || !parcelaConfere) && <button type="button" className="btn ghost sm" onClick={() => set('valor_parcela', brl(sugestaoParcela))}>usar</button>}
            </div>
          </Field>
          <Field label="Vencimentos"><input className="input" value={f.vencimentos} onChange={(e) => set('vencimentos', e.target.value)} placeholder="Todo dia 10, de 10/11/2026 a 10/08/2027" /></Field>
        </div>

        <h3 style={{ margin: '8px 0 0' }}>Datas</h3>
        <div className="grid2">
          <Field label="Data do contrato"><input className="input" type="date" value={f.data} onChange={(e) => set('data', e.target.value)} required /></Field>
          <div className="grid2">
            <Field label="Vigência: início"><input className="input" type="month" value={f.vigencia_inicio} onChange={(e) => { set('vigencia_inicio', e.target.value); if (e.target.value) set('vigencia_fim', maisUmAno(e.target.value)) }} required /></Field>
            <Field label="fim"><input className="input" type="month" value={f.vigencia_fim} onChange={(e) => set('vigencia_fim', e.target.value)} required /></Field>
          </div>
        </div>
        <h3 style={{ margin: '8px 0 0' }}>Cláusula especial <span className="small muted" style={{ fontWeight: 400 }}>(opcional)</span></h3>
        <Field hint="Só se houver alguma combinação especial com o lead. O texto entra no final do contrato, antes das assinaturas, como acordo firmado entre as partes. Deixe em branco se não houver.">
          <textarea className="textarea" style={{ minHeight: 80 }} maxLength={3000} value={f.clausula_especial || ''} onChange={(e) => set('clausula_especial', e.target.value)}
            placeholder="Ex.: O CONTRATADO concederá ao CONTRATANTE 2 (dois) encontros individuais adicionais de 1 hora durante a vigência." />
        </Field>
        {erro && <div className="small late">{erro}</div>}
        <div className="small muted">Ao enviar, o contrato é criado no Google Drive da vendedora (pasta "Contratos eCRM") e vai por e-mail, pela Autentique, para o Murilo ({signatario}) e para o lead assinarem.</div>
      </form>
    </Modal>
  )
}
