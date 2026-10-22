// Relatório da consultoria gratuita, automático.
// Roda pelo pg_cron (a cada 10 min). Para cada encontro que já terminou (de 45 min a 3 dias atrás):
//  1) procura no evento da agenda da consultora os anexos do Google Meet (gravação, transcrição, Anotações do Gemini);
//  2) lê o documento "Anotações do Gemini" (resumo, detalhes e próximas etapas, feitos a partir da transcrição) e,
//     se houver, a transcrição; guarda o texto em deals.relatorio_fonte.
//  3) A tarefa agendada "Relatórios da consultoria" (Claude, de hora em hora) lê relatorio_fonte, escreve o relatório
//     para o lead (dores, desejos e caminhos: Processo de Enfermagem + Nursing Plan), grava relatorio_texto /
//     relatorio_pronto_em e cria a tarefa "📝 Relatório da consultoria pronto…" (o CRM avisa no funil e com som).
// Autorização: header "Authorization: Bearer <segredo cron_secret do Vault>".
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (delegação com calendar.events e documents.readonly)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { levarArquivosParaSessao } from '../_shared/plat.ts'

const TZ_OFF = '-03:00'
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents.readonly'
const DRIVE_RO_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
type SA = { client_email: string; private_key: string; token_uri?: string }

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const tokens = new Map<string, string>()
async function googleToken(sa: SA, subject: string, scope: string): Promise<string> {
  const k = subject + ' ' + scope
  if (tokens.has(k)) return tokens.get(k)!
  const now = Math.floor(Date.now() / 1000)
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, sub: subject, scope, aud, iat: now, exp: now + 3600 }))}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const res = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }) })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = String(data.error_description || data.error || res.status)
    if (/unauthorized_client|not authorized/i.test(e)) throw new Error(scope === DOCS_SCOPE ? 'falta autorizar a leitura de documentos (documents.readonly) na delegação do Google Workspace' : 'a conta de serviço não está autorizada no Google Workspace')
    throw new Error('Google: ' + e)
  }
  tokens.set(k, data.access_token)
  return data.access_token
}
async function gcal(token: string, path: string) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('Google Agenda: ' + (data?.error?.message || res.status))
  return data
}
const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ')
const tipo = (a: any) => /^video\//.test(a.mimeType || '') ? 'gravacao' : /transcri/i.test(a.title || '') ? 'transcricao' : /anota|notes|gemini/i.test(a.title || '') ? 'anotacoes' : 'arquivo'

/** Anexos do Meet no evento da reunião (evento do CRM ou, se marcado direto na agenda, achado pelo nome do lead). */
async function buscarArquivos(admin: any, sa: SA, d: any, titulo: string): Promise<any[] | null> {
  const nome = d.contact?.name || d.title
  let ev: any = null
  if (d.calendar_event_id && d.seller?.email) ev = await gcal(await googleToken(sa, d.seller.email, CAL_SCOPE), `/${encodeURIComponent(d.calendar_event_id)}`).catch(() => null)
  if (!ev && d.meeting_date) {
    const words = norm(nome).split(' ').filter((w) => w.length > 2)
    const key = (w: string) => w.replace(/Z/g, 'S')
    const ini = new Date(`${d.meeting_date}T00:00:00${TZ_OFF}`).toISOString()
    const fim = new Date(`${d.meeting_date}T23:59:59${TZ_OFF}`).toISOString()
    const { data: list } = await admin.from('calendar_sellers').select('email').eq('active', true)
    for (const s of list ?? []) {
      const r = await gcal(await googleToken(sa, s.email, CAL_SCOPE), `?singleEvents=true&timeMin=${encodeURIComponent(ini)}&timeMax=${encodeURIComponent(fim)}`).catch(() => null)
      ev = (r?.items ?? []).find((e: any) => e.status !== 'cancelled' && norm(e.summary) !== norm(titulo)
        && words.filter((w) => key(norm(`${e.summary} ${e.description ?? ''}`)).includes(key(w))).length >= Math.min(2, words.length))
      if (ev) break
    }
  }
  if (!ev) return null
  return (ev.attachments ?? []).map((a: any) => ({ kind: tipo(a), title: a.title || 'Arquivo', url: a.fileUrl, mime: a.mimeType || null }))
}

/** Lê as Anotações do Gemini: seções Resumo e Próximas etapas, já no formato do WhatsApp. */
/** Plano B, sem o escopo documents.readonly: exporta o documento como texto pelo Drive (escopo drive, já usado nos contratos). */
async function linhasPeloDrive(sa: SA, email: string, docId: string): Promise<string[]> {
  let ultimo = ''
  for (const scope of [DRIVE_RO_SCOPE, DRIVE_SCOPE]) {
    try {
      const tk = await googleToken(sa, email, scope)
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tk}` } })
      if (!r.ok) { ultimo = 'Drive: ' + r.status; continue }
      return (await r.text()).replace(/^﻿/, '').split(/\r?\n/)
        .map((l) => l.replace(/\s*\(\d{2}:\d{2}:\d{2}\)/g, '').replace(/^\s*[*\-•]\s+/, '• ').trimEnd())
        .filter((l) => l.trim())
    } catch (e) { ultimo = (e as Error).message }
  }
  throw new Error('não consegui ler o documento do Gemini (' + (ultimo || 'sem resposta') + '): autorize documents.readonly ou drive na delegação do Google Workspace')
}

async function lerAnotacoes(sa: SA, email: string, docId: string) {
  const linhas: string[] = []
  let data: any = null
  try {
    const tk = await googleToken(sa, email, DOCS_SCOPE)
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, { headers: { Authorization: `Bearer ${tk}` } })
    data = await res.json().catch(() => ({}))
    if (!res.ok) data = null
  } catch { data = null }
  if (!data) linhas.push(...await linhasPeloDrive(sa, email, docId))
  for (const el of data?.body?.content ?? []) {
    const p = el.paragraph
    if (!p) continue
    const t = (p.elements ?? []).map((x: any) => {
      const c = String(x.textRun?.content ?? '').replace(/\u000b/g, '\n')
      const nu = c.trim()
      if (!nu) return c
      return x.textRun?.textStyle?.bold && !/^#|^\d{2}:\d{2}/.test(nu) ? c.replace(nu, `*${nu}*`) : c
    }).join('').replace(/\s*\(\d{2}:\d{2}:\d{2}\)/g, '').replace(/[ \t]+\n/g, '\n').trim()
    if (t) linhas.push((p.bullet ? '• ' : '') + t)
  }
  const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*/g, '').trim().toLowerCase()
  const idx = (re: RegExp, from = 0) => linhas.findIndex((l, i) => i >= from && re.test(sem(l)) && l.length < 60)
  const iResumo = idx(/^resumo$|^summary$/)
  const iEtapas = idx(/^proximas etapas|^next steps|^proximos passos/, Math.max(0, iResumo + 1))
  const iDetalhes = idx(/^detalhes$|^details$/, Math.max(0, iResumo + 1))
  const ate = (...xs: number[]) => Math.min(...xs.filter((x) => x >= 0), linhas.length)
  const fimGeral = linhas.findIndex((l) => /revise as anotacoes|voce deve revisar|gemini pode cometer|^transcricao$|^transcript$/.test(sem(l)))
  const fimResumo = ate(iEtapas > iResumo ? iEtapas : -1, iDetalhes > iResumo ? iDetalhes : -1, fimGeral > iResumo ? fimGeral : -1)
  const fimEtapas = ate(iDetalhes > iEtapas ? iDetalhes : -1, fimGeral > iEtapas ? fimGeral : -1)
  // subtítulos do resumo (linha curta sem pontuação final) em negrito
  const resumo = iResumo >= 0 ? linhas.slice(iResumo + 1, fimResumo)
    .map((l) => (!/^[•*]/.test(l) && l.length < 70 && !/[.!?:;]$/.test(l) ? `*${l.replace(/\*/g, '')}*` : l)).join('\n\n') : ''
  // próximos passos: só os do lead (tira os da consultora e o nome entre colchetes)
  const consultora = sem(String(email).split('@')[0])
  const etapas = iEtapas >= 0 ? linhas.slice(iEtapas + 1, fimEtapas).map((l) => {
    const m = l.replace(/^[•*]\s*/, '').match(/^\[([^\]]+)\]\s*(.*)$/)
    if (!m) return '• ' + l.replace(/^[•*]\s*/, '')
    if (sem(m[1]).split(/\s+/).includes(consultora) || /^(adriana|carmem|diego|viviane|murilo|mari)\b/.test(sem(m[1]))) return ''
    return '• ' + m[2]
  }).filter(Boolean).join('\n') : ''
  const fonte = linhas.slice(0, fimGeral > 0 ? fimGeral : linhas.length).join('\n')
  return { resumo: resumo.slice(0, 3000), etapas: etapas.slice(0, 1500), fonte }
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: ok } = await admin.rpc('check_cron_secret', { p: token })
  if (!ok) return json({ error: 'não autorizado' }, 401)

  let sa: SA | null = null
  try { sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || 'null') } catch { sa = null }
  if (!sa?.client_email) return json({ ok: false, error: 'conta do Google não conectada' })
  const { data: st } = await admin.from('org_settings').select('slot_title').eq('id', 1).single()
  const TITULO = st?.slot_title || 'DISPONÍVEL PARA AGENDAMENTO'

  const agora = Date.now()
  const desde = new Date(agora - 3 * 86_400_000).toISOString().slice(0, 10)
  const { data: deals } = await admin.from('deals')
    .select('id, title, contact_id, owner_id, meeting_date, meeting_time, calendar_event_id, meeting_files, relatorio_checado_em, plat_sessao_id, seller:calendar_sellers(name, email), contact:contacts(name)')
    .gte('meeting_date', desde).is('relatorio_pronto_em', null).is('relatorio_fonte', null).not('meeting_time', 'is', null).not('seller_id', 'is', null)
    .order('meeting_date', { ascending: false }).limit(40)

  const feitos: any[] = []
  for (const d of deals ?? []) {
    const ini = new Date(`${d.meeting_date}T${String(d.meeting_time).slice(0, 5)}:00${TZ_OFF}`).getTime()
    if (agora < ini + 45 * 60_000 || agora > ini + 3 * 86_400_000) continue
    if (d.relatorio_checado_em && agora - new Date(d.relatorio_checado_em).getTime() < 15 * 60_000) continue
    if (feitos.length >= 8) break
    const marca: any = { relatorio_checado_em: new Date().toISOString() }
    try {
      let files: any[] = Array.isArray(d.meeting_files) ? d.meeting_files : []
      if (!files.some((f) => f?.kind === 'anotacoes')) {
        const novos = await buscarArquivos(admin, sa, d, TITULO)
        if (novos?.length) {
          files = novos
          marca.meeting_files = novos
          marca.meeting_files_checked_at = new Date().toISOString()
          await levarArquivosParaSessao(admin, d.id, novos).catch(() => null)
        }
      }
      const doc = files.find((f) => f?.kind === 'anotacoes' && f?.url)
      const docId = String(doc?.url ?? '').match(/\/document\/d\/([\w-]+)/)?.[1]
      if (!docId) { marca.relatorio_erro = 'as Anotações do Gemini ainda não apareceram no evento'; await admin.from('deals').update(marca).eq('id', d.id); feitos.push({ id: d.id, ok: false, erro: marca.relatorio_erro }); continue }
      const r = await lerAnotacoes(sa, d.seller.email, docId)
      if (!r.fonte.trim()) { marca.relatorio_erro = 'o documento do Gemini veio vazio'; await admin.from('deals').update(marca).eq('id', d.id); feitos.push({ id: d.id, ok: false, erro: marca.relatorio_erro }); continue }
      // transcrição completa (quando o Meet anexou o documento de transcrição): ajuda a achar dores e desejos nas palavras do lead
      let transcricao = ''
      const tr = files.find((f) => f?.kind === 'transcricao' && f?.url)
      const trId = String(tr?.url ?? '').match(/\/document\/d\/([\w-]+)/)?.[1]
      if (trId) transcricao = (await linhasPeloDrive(sa, d.seller.email, trId).catch(() => [] as string[])).join('\n')
      const fonte = `=== ANOTAÇÕES DO GEMINI ===\n${r.fonte}` + (transcricao ? `\n\n=== TRANSCRIÇÃO ===\n${transcricao}` : '')
      Object.assign(marca, { relatorio_fonte: fonte.slice(0, 60000), relatorio_fonte_em: new Date().toISOString(), relatorio_erro: null, relatorio_doc_url: doc.url })
      await admin.from('deals').update(marca).eq('id', d.id)
      feitos.push({ id: d.id, ok: true, lead: d.contact?.name || d.title })
    } catch (e) {
      marca.relatorio_erro = (e as Error).message
      await admin.from('deals').update(marca).eq('id', d.id)
      feitos.push({ id: d.id, ok: false, erro: marca.relatorio_erro })
    }
  }
  return json({ ok: true, processados: feitos })
})
