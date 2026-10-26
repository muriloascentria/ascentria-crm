import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { leadAssinouEm } from '../lib/contrato'

/**
 * Aviso VERDE e chamativo (em todas as telas) assim que o lead assina o contrato na Autentique.
 * Aparece para a consultora do encontro, para quem é dona do card e para a gestão, por 3 dias ou até clicar em "Vi".
 * Mostra também se o Murilo já assinou (contrato completo) ou se ainda falta.
 */
export default function ContratosAssinados() {
  const { profile, settings, isManager } = useApp()
  const navigate = useNavigate()
  const [itens, setItens] = useState([])
  const chave = `contratosVistos:${profile?.id}`
  const [vistos, setVistos] = useState(() => { try { return JSON.parse(localStorage.getItem(chave) || '[]') } catch { return [] } })

  const load = useCallback(async () => {
    const desde = new Date(Date.now() - 20 * 86_400_000).toISOString()
    const { data } = await supabase.from('deals')
      .select('id, title, owner_id, contrato_status, contrato_assinaturas, contrato_assinado_em, contrato_gerado_em, contact:contacts(name), seller:calendar_sellers(name, email)')
      .in('contrato_status', ['enviado', 'assinado'])
      .or(`contrato_gerado_em.gte.${desde},contrato_assinado_em.gte.${desde}`)
    const meuEmail = String(profile?.email || '').toLowerCase()
    const limite = Date.now() - 3 * 86_400_000
    setItens((data || [])
      .map((d) => ({ ...d, leadEm: leadAssinouEm(d, settings) }))
      .filter((d) => d.leadEm && new Date(d.leadEm).getTime() >= limite)
      .filter((d) => isManager || d.owner_id === profile?.id || String(d.seller?.email || '').toLowerCase() === meuEmail)
      .sort((a, b) => (a.leadEm < b.leadEm ? 1 : -1)))
  }, [profile?.id, profile?.email, settings, isManager])
  useEffect(() => {
    load()
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [load])

  // a marca "vi" vale para cada etapa: o aviso volta quando o Murilo também assinar
  const marca = (d) => `${d.id}:${d.contrato_status === 'assinado' ? 'todos' : 'lead'}`
  const novos = itens.filter((d) => !vistos.includes(marca(d)) && !vistos.includes(d.id))
  const vi = (d) => {
    const n = [...new Set([...vistos, marca(d)])].slice(-300)
    setVistos(n)
    try { localStorage.setItem(chave, JSON.stringify(n)) } catch { /* sem armazenamento: some só nesta sessão */ }
  }

  // título da aba piscando enquanto houver aviso novo
  useEffect(() => {
    if (!novos.length) return
    const base = document.title
    let on = false
    const iv = setInterval(() => { on = !on; document.title = on ? '🎉 CONTRATO ASSINADO' : base }, 1200)
    return () => { clearInterval(iv); document.title = base }
  }, [novos.length])

  if (!novos.length) return null
  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="alert-assinado" role="alert">
      <div className="alert-assinado-titulo">🎉 {novos.length === 1 ? 'O LEAD ASSINOU O CONTRATO!' : `${novos.length} LEADS ASSINARAM O CONTRATO!`}</div>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        {novos.map((d) => (
          <div key={d.id} className="alert-assinado-item">
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{d.contact?.name || d.title}</b>
              {d.seller?.name && <> · venda da <b>{d.seller.name}</b></>}
              <span> · assinou em {quando(d.leadEm)}</span>
              <span> · {d.contrato_status === 'assinado' ? '✅ contrato completo (Murilo também assinou)' : '⏳ falta só a assinatura do Murilo'}</span>
            </div>
            <button type="button" className="btn sm alert-assinado-btn" onClick={() => navigate(`/funil?negocio=${d.id}`)}>Abrir card</button>
            <button type="button" className="btn sm" onClick={() => vi(d)}>✓ Vi</button>
          </div>
        ))}
      </div>
    </div>
  )
}
