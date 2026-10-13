import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { waLink, abrirWhatsApp } from '../lib/manual'
import { splitParts } from '../lib/wa'
import AbrirEm from './AbrirEm'

/**
 * Aviso URGENTE (em todas as telas) quando chega a hora de um lembrete de reunião que precisa sair à mão.
 * Cada lembrete tem "Enviar lembrete" (abre o WhatsApp com o texto pronto) e "Enviei" (marca a tarefa como feita).
 * Enquanto houver lembrete pendente, o título da aba do navegador pisca.
 */
export default function LembretesUrgentes() {
  const { toast, profile } = useApp()
  const [itens, setItens] = useState([])
  const [abertos, setAbertos] = useState({}) // activityId → quantas partes já foram abertas no WhatsApp

  const load = useCallback(async () => {
    const { data } = await supabase.from('activities')
      .select('id, title, description, created_at, contact_id, deal:deals(id, title, meeting_date, meeting_time, contact_id)')
      .eq('done', false).like('title', 'Enviar lembrete à mão%')
      .gte('created_at', new Date(Date.now() - 2 * 86_400_000).toISOString())
      .order('created_at')
    // some sozinho 1h depois do horário do encontro
    const valeAinda = (a) => {
      const d = a.deal
      if (!d?.meeting_date || !d?.meeting_time) return true
      return new Date(`${d.meeting_date}T${String(d.meeting_time).slice(0, 5)}:00-03:00`).getTime() > Date.now() - 3_600_000
    }
    const lista = (data || []).filter(valeAinda)
    // contato de cada lembrete (telefone para abrir o WhatsApp e nome para o aviso)
    const ids = [...new Set(lista.map((a) => a.contact_id || a.deal?.contact_id).filter(Boolean))]
    const { data: cs } = ids.length ? await supabase.from('contacts').select('id, name, phone, wa_id').in('id', ids) : { data: [] }
    setItens(lista.map((a) => ({ ...a, contato: (cs || []).find((c) => c.id === (a.contact_id || a.deal?.contact_id)) || null })))
  }, [])
  useEffect(() => {
    load()
    const iv = setInterval(load, 60_000)
    return () => clearInterval(iv)
  }, [load])

  // título da aba piscando enquanto houver lembrete
  useEffect(() => {
    if (!itens.length) return
    const base = document.title
    let on = false
    const iv = setInterval(() => { on = !on; document.title = on ? `🚨 LEMBRETE (${itens.length})` : base }, 1000)
    return () => { clearInterval(iv); document.title = base }
  }, [itens.length])

  if (!itens.length) return null

  const texto = (a) => String(a.description || '').split(/\n\s*\n/).slice(1).join('\n\n').trim() || String(a.description || '')
  const qual = (a) => (a.title.replace(/^Enviar lembrete à mão — /, '').split(':')[0] || 'Lembrete').trim()
  const hora = (d) => (d?.meeting_time ? String(d.meeting_time).slice(0, 5).replace(':', 'h') : '')
  // lembrete em partes (separadas por ---): cada parte vai como uma mensagem; o botão abre a próxima
  const partes = (a) => splitParts(texto(a)).map((t) => t.trim()).filter(Boolean)
  const enviar = (a) => {
    const ps = partes(a)
    const i = Math.min(abertos[a.id] || 0, ps.length - 1)
    const link = waLink(a.contato, ps[i] || texto(a))
    if (!link) return toast('Contato sem telefone', 'err')
    abrirWhatsApp(link)
    setAbertos((x) => ({ ...x, [a.id]: i + 1 }))
  }
  const rotulo = (a) => {
    const n = partes(a).length, feitas = abertos[a.id] || 0
    if (n <= 1) return feitas ? '📲 Abrir de novo' : '📲 Enviar lembrete'
    return feitas >= n ? '📲 Abrir a última de novo' : `📲 Enviar parte ${feitas + 1} de ${n}`
  }
  const terminou = (a) => (abertos[a.id] || 0) >= partes(a).length
  const enviei = async (a) => {
    const { error } = await supabase.from('activities').update({ done: true, done_at: new Date().toISOString() }).eq('id', a.id)
    if (error) return toast(error.message, 'err')
    setItens((l) => l.filter((x) => x.id !== a.id))
    toast('Lembrete marcado como enviado')
  }

  return (
    <div className="alert-urgente" role="alert">
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="alert-urgente-titulo">🚨 {itens.length === 1 ? 'LEMBRETE DE REUNIÃO PARA ENVIAR AGORA' : `${itens.length} LEMBRETES DE REUNIÃO PARA ENVIAR AGORA`} 🚨</div>
        <AbrirEm />
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        {itens.map((a) => (
          <div key={a.id} className="alert-urgente-item">
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{a.contato?.name || a.deal?.title || 'Lead'}</b>
              {a.deal?.meeting_time && <> · reunião às <b>{hora(a.deal)}</b></>}
              <span style={{ opacity: 0.85 }}> · {qual(a)}</span>
            </div>
            <button type="button" className={'btn sm' + (terminou(a) ? '' : ' alert-urgente-btn')} onClick={() => enviar(a)}>{rotulo(a)}</button>
            <button type="button" className={'btn sm' + (terminou(a) ? ' alert-urgente-btn' : '')} onClick={() => enviei(a)}>✓ Enviei</button>
          </div>
        ))}
      </div>
      {profile && <div className="small alert-urgente-dica" style={{ marginTop: 6, opacity: 0.9 }}>Clique em <b>Enviar</b>, aperte Enter no WhatsApp (se o lembrete tiver partes, volte e envie a próxima) e no fim clique em <b>Enviei</b>. O aviso só some quando todos forem enviados.</div>}
    </div>
  )
}
