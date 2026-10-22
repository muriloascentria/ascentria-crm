import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Avisos com som e notificação do sistema, mesmo com o CRM numa aba de fundo:
 *  - lembrete de reunião para enviar à mão (tarefa "Enviar lembrete à mão…");
 *  - reunião começando agora;
 *  - relatório da consultoria pronto para enviar ao lead;
 *  - lead novo chegando em Recebidos.
 * Cada aviso toca uma vez só (lembrado no navegador). O som precisa de um clique para ser liberado
 * (regra dos navegadores): por isso a faixa "Ativar avisos com som" aparece até a pessoa clicar.
 */
const CHAVE = 'avisosVistos'
const PREF = 'avisosSom'
const lerVistos = () => { try { return new Set(JSON.parse(localStorage.getItem(CHAVE) || '[]')) } catch { return new Set() } }
const gravarVistos = (s) => { try { localStorage.setItem(CHAVE, JSON.stringify([...s].slice(-500))) } catch { /* sem armazenamento */ } }

let ctx = null
function bip(tipo = 'lembrete') {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    // lembrete: três toques mais agudos; reunião: dois; lead novo: um toque suave
    const notas = tipo === 'lembrete' ? [880, 1175, 880] : tipo === 'reuniao' ? [660, 990] : [740]
    notas.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      const t = ctx.currentTime + i * 0.28
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(tipo === 'lead' ? 0.15 : 0.35, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.26)
    })
  } catch { /* sem som neste navegador */ }
}

function notificar(titulo, corpo, tag) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const n = new Notification(titulo, { body: corpo, tag, icon: '/icon-192.png', requireInteraction: tag.startsWith('lembrete') })
    n.onclick = () => { window.focus(); if (!location.hash.includes('funil')) location.hash = '#/funil'; n.close() }
  } catch { /* alguns celulares não mostram notificação de página */ }
}

export default function AvisosFundo() {
  const [ligado, setLigado] = useState(() => { try { return localStorage.getItem(PREF) === '1' } catch { return false } })
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const primeira = useRef(true)

  const ativar = async () => {
    bip('lead') // o clique libera o som no navegador
    if ('Notification' in window && Notification.permission === 'default') {
      try { setPerm(await Notification.requestPermission()) } catch { /* ignore */ }
    }
    setLigado(true)
    try { localStorage.setItem(PREF, '1') } catch { /* ignore */ }
  }

  const verificar = useCallback(async () => {
    const vistos = lerVistos()
    const novos = []
    const agora = Date.now()
    // 1) lembretes à mão pendentes (últimos 2 dias)
    const { data: acts } = await supabase.from('activities').select('id, title, created_at')
      .eq('done', false).like('title', 'Enviar lembrete à mão%').gte('created_at', new Date(agora - 2 * 86_400_000).toISOString())
    for (const a of acts || []) {
      const k = 'lembrete:' + a.id
      if (!vistos.has(k)) { vistos.add(k); novos.push({ tipo: 'lembrete', k, titulo: '🚨 Lembrete de reunião para enviar', corpo: a.title.replace(/^Enviar lembrete à mão — /, '') }) }
    }
    // 2) reuniões começando (do horário marcado até 10 min depois)
    const hoje = new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10)
    const { data: reus } = await supabase.from('deals').select('id, title, meeting_date, meeting_time, seller:calendar_sellers(name), contact:contacts(name)')
      .eq('status', 'open').eq('meeting_date', hoje)
    for (const d of reus || []) {
      if (!d.meeting_time) continue
      const ini = new Date(`${d.meeting_date}T${String(d.meeting_time).slice(0, 5)}:00-03:00`).getTime()
      if (agora < ini || agora > ini + 10 * 60_000) continue
      const k = `reuniao:${d.id}:${d.meeting_date}`
      if (!vistos.has(k)) { vistos.add(k); novos.push({ tipo: 'reuniao', k, titulo: '🎥 Reunião começando', corpo: `${d.contact?.name || d.title}${d.seller?.name ? ` com ${d.seller.name}` : ''} — ${String(d.meeting_time).slice(0, 5)}` }) }
    }
    // 3) relatório da consultoria pronto para enviar ao lead (feito sozinho a partir das Anotações do Gemini)
    const { data: rels } = await supabase.from('deals').select('id, title, relatorio_pronto_em, relatorio_enviado_em, contact:contacts(name)')
      .gte('relatorio_pronto_em', new Date(agora - 2 * 86_400_000).toISOString())
    for (const d of rels || []) {
      if (d.relatorio_enviado_em) continue
      const k = 'relatorio:' + d.id
      if (!vistos.has(k)) { vistos.add(k); novos.push({ tipo: 'reuniao', k, titulo: '📝 Relatório pronto para enviar', corpo: `Consultoria de ${d.contact?.name || d.title}: o relatório já está pronto no card.` }) }
    }
    // 4) leads novos (últimas 3 horas) em uma coluna de entrada
    const { data: entradas } = await supabase.from('stages').select('id').eq('role', 'inbox')
    const ids = (entradas || []).map((x) => x.id)
    const { data: leads } = ids.length ? await supabase.from('deals').select('id, title, created_at, stage_id')
      .in('stage_id', ids).gte('created_at', new Date(agora - 3 * 3_600_000).toISOString()) : { data: [] }
    const leadsNovos = []
    for (const d of leads || []) {
      const k = 'lead:' + d.id
      if (!vistos.has(k)) { vistos.add(k); leadsNovos.push(d) }
    }
    if (leadsNovos.length) novos.push({ tipo: 'lead', k: 'lead:' + leadsNovos[0].id, titulo: leadsNovos.length === 1 ? '📥 Lead novo em Recebidos' : `📥 ${leadsNovos.length} leads novos em Recebidos`, corpo: leadsNovos.map((d) => d.title).slice(0, 4).join(', ') })
    gravarVistos(vistos)
    // na primeira verificação depois de abrir o CRM só marca o que já existia (não dispara uma enxurrada)
    if (primeira.current) { primeira.current = false; return }
    if (!ligado) return
    for (const n of novos) {
      bip(n.tipo)
      notificar(n.titulo, n.corpo, n.k)
    }
  }, [ligado])

  // depois de recarregar a página, o navegador só libera o som após um clique ou tecla: o primeiro libera
  useEffect(() => {
    const liberar = () => { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume() } catch { /* ignore */ } }
    window.addEventListener('pointerdown', liberar, { once: true })
    window.addEventListener('keydown', liberar, { once: true })
    return () => { window.removeEventListener('pointerdown', liberar); window.removeEventListener('keydown', liberar) }
  }, [])

  useEffect(() => {
    const rodar = () => verificar().catch((e) => console.warn('avisos', e?.message))
    rodar()
    const iv = setInterval(rodar, 60_000)
    return () => clearInterval(iv)
  }, [verificar])

  if (ligado && perm !== 'default') return null
  return (
    <div className="aviso-som" role="status">
      <span>🔔 Receba avisos com som (lembretes, reunião começando, relatório pronto e lead novo), mesmo com o CRM em outra aba.</span>
      <button type="button" className="btn sm primary" onClick={ativar}>Ativar avisos com som</button>
    </div>
  )
}
