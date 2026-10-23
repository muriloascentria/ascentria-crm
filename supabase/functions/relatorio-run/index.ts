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
    // espera 90 min: o Gemini termina as anotações depois do fim da reunião
    if (agora < ini + 90 * 60_000 || agora > ini + 3 * 86_400_000) continue
    if (d.relatorio_checado_em && agora - new Date(d.relatorio_checado_em).getTime() < 15 * 60_000) continue
    if (feitos.length >= 8) break
    const marca: any = { relatorio_checado_em: new Date().toISOString() }
    try {
      // busca os anexos de novo a cada rodada: se a reunião caiu e recomeçou, o Meet anexa um segundo documento
      let files: any[] = Array.isArray(d.meeting_files) ? d.meeting_files : []
      const novos = await buscarArquivos(admin, sa, d, TITULO).catch(() => null)
      if (novos?.length && JSON.stringify(novos) !== JSON.stringify(files)) {
        files = novos
        marca.meeting_files = novos
        marca.meeting_files_checked_at = new Date().toISOString()
        await levarArquivosParaSessao(admin, d.id, novos).catch(() => null)
      }
      const docs = files.filter((f) => f?.kind === 'anotacoes' && /\/document\/d\//.test(String(f?.url ?? '')))
      if (!docs.length) { marca.relatorio_erro = 'as Anotações do Gemini ainda não apareceram no evento'; await admin.from('deals').update(marca).eq('id', d.id); feitos.push({ id: d.id, ok: false, erro: marca.relatorio_erro }); continue }
      // lê todos os documentos de anotações (e de transcrição) e junta os que têm conteúdo de verdade
      const partes: string[] = []
      let principal = docs[0]
      for (const f of [...docs, ...files.filter((x) => x?.kind === 'transcricao')]) {
        const id = String(f.url).match(/\/document\/d\/([\w-]+)/)?.[1]
        if (!id) continue
        const texto = f.kind === 'anotacoes' ? (await lerAnotacoes(sa, d.seller.email, id).catch(() => ({ fonte: '' }))).fonte
          : (await linhasPeloDrive(sa, d.seller.email, id).catch(() => [] as string[])).join('\n')
        if (texto && !/resumo desta reuni[aã]o n[aã]o foi gerado/i.test(texto) && texto.length > 800) {
          partes.push(`=== ${f.kind === 'anotacoes' ? 'ANOTAÇÕES DO GEMINI' : 'TRANSCRIÇÃO'} (${f.title}) ===\n${texto}`)
          if (f.kind === 'anotacoes') principal = f
        }
      }
      const fonte = partes.join('\n\n')
      if (fonte.length < 1500 && agora < ini + 8 * 3_600_000) {
        marca.relatorio_erro = 'aguardando o Gemini: as anotações ainda estão vazias ou curtas'
        await admin.from('deals').update(marca).eq('id', d.id); feitos.push({ id: d.id, ok: false, erro: marca.relatorio_erro }); continue
      }
      Object.assign(marca, { relatorio_fonte: (fonte || 'sem conteúdo').slice(0, 60000), relatorio_fonte_em: new Date().toISOString(), relatorio_erro: null, relatorio_doc_url: principal.url })
      await admin.from('deals').update(marca).eq('id', d.id)
      feitos.push({ id: d.id, ok: true, lead: d.contact?.name || d.title })
    } catch (e) {
      marca.relatorio_erro = (e as Error).message
      await admin.from('deals').update(marca).eq('id', d.id)
      feitos.push({ id: d.id, ok: false, erro: marca.relatorio_erro })
    }
  }

  // 2) documento no papel timbrado: para os diagnósticos (SWOT) que a tarefa agendada já escreveu
  const gerados: any[] = []
  const { data: cfg } = await admin.from('org_settings').select('relatorio_template_id, relatorio_folder_id, contract_signer_email').eq('id', 1).single()
  const { data: prontos } = await admin.from('deals')
    .select('id, title, contact_id, owner_id, relatorio_swot, seller:calendar_sellers(name), contact:contacts(name)')
    .not('relatorio_swot', 'is', null).is('relatorio_doc_id', null).limit(4)
  for (const d of prontos ?? []) {
    try {
      if (!cfg?.relatorio_template_id) throw new Error('modelo do relatório não configurado')
      const r = await gerarDocumento(sa, String(cfg.contract_signer_email || 'murilo@ascentria.com.br'), cfg.relatorio_template_id, cfg.relatorio_folder_id, d.relatorio_swot)
      const nome = String(d.contact?.name || d.title || '').trim().split(/\s+/)[0]
      const consultora = String(d.relatorio_swot?.consultora || d.seller?.name || '').trim().split(/\s+/)[0]
      const homem = /^(diego|murilo)$/i.test(consultora)
      const texto = [
        `Oi${nome ? `, ${nome}` : ''}! Aqui é ${homem ? 'o' : 'a'} ${consultora}, da equipe do Enfermeiro Murilo. 😊`,
        `${homem ? 'Obrigado' : 'Obrigada'} pela nossa conversa na consultoria gratuita. Preparei o seu *Relatório de Diagnóstico Profissional*, com o que você me contou organizado em forças, fraquezas, oportunidades e ameaças.`,
        'O arquivo segue logo abaixo. Qualquer dúvida, é só me chamar por aqui!',
      ].join('\n\n')
      await admin.from('deals').update({ relatorio_doc_id: r.id, relatorio_doc_link: r.link, relatorio_texto: texto, relatorio_pronto_em: new Date().toISOString(), relatorio_erro: null }).eq('id', d.id)
      const { data: jaTem } = await admin.from('activities').select('id').eq('deal_id', d.id).eq('done', false).like('title', '📝 Relatório da consultoria pronto%').limit(1)
      if (!jaTem?.length) await admin.from('activities').insert({
        type: 'task', title: `📝 Relatório da consultoria pronto — enviar a ${d.contact?.name || d.title}`,
        description: 'O Relatório de Diagnóstico (análise SWOT, papel timbrado da Ascentria) está pronto no card, em "Reunião gravada". Baixe o PDF e envie ao lead pelo WhatsApp.',
        deal_id: d.id, contact_id: d.contact_id, assigned_to: d.owner_id, due_at: new Date().toISOString(), done: false,
      })
      gerados.push({ id: d.id, ok: true, doc: r.link })
    } catch (e) {
      await admin.from('deals').update({ relatorio_erro: 'documento: ' + (e as Error).message }).eq('id', d.id)
      gerados.push({ id: d.id, ok: false, erro: (e as Error).message })
    }
  }
  return json({ ok: true, processados: feitos, documentos: gerados })
})

// ——— documento do relatório (cópia do modelo com o papel timbrado + texto do diagnóstico) ———
const VERDE = { red: 0.36, green: 0.43, blue: 0.34 }
const u16 = (t: string) => t.length // String.length já conta em UTF-16, como a API do Google Docs

async function gerarDocumento(sa: SA, dono: string, modeloId: string, pastaId: string | null, sw: any) {
  const tk = await googleToken(sa, dono, DRIVE_SCOPE)
  const h = { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }
  const titulo = `Diagnóstico SWOT - ${sw.participante || 'Lead'} - Consultoria ${String(sw.data_curta || '').replace(/\//g, '-') || new Date().toISOString().slice(0, 10)}`
  const cp = await fetch(`https://www.googleapis.com/drive/v3/files/${modeloId}/copy?supportsAllDrives=true&fields=id`, { method: 'POST', headers: h, body: JSON.stringify({ name: titulo, ...(pastaId ? { parents: [pastaId] } : {}) }) })
  const c: any = await cp.json().catch(() => ({}))
  if (!cp.ok) throw new Error('Drive (cópia): ' + (c?.error?.message || cp.status))
  const paras: [string, string][] = [
    ['T', 'RELATÓRIO DE DIAGNÓSTICO PROFISSIONAL'], ['ST', 'Consultoria Gratuita · Análise SWOT'], ['E', ''],
    ['I', `Participante: ${sw.participante || ''}`], ['I', `Data da consultoria: ${sw.data || ''}`], ['I', `Consultora responsável: ${sw.consultora || ''}`],
    ...(sw.local ? [['I', `Local de residência: ${sw.local}`] as [string, string]] : []),
    ['S', 'APRESENTAÇÃO'],
    ['P', `Este relatório apresenta o diagnóstico da situação profissional relatada por ${String(sw.participante || '').split(' ')[0] || 'a participante'} durante a consultoria gratuita, organizado no modelo SWOT: forças e fraquezas (fatores internos) e oportunidades e ameaças (fatores externos). As informações registradas correspondem exclusivamente ao que foi relatado ao longo da conversa.`],
    ['S', 'CONTEXTO E OBJETIVO DECLARADO'], ['P', sw.contexto || ''],
    ['S', 'FORÇAS'], ...(sw.forcas || []).map((x: string) => ['B', x] as [string, string]),
    ['S', 'FRAQUEZAS'], ...(sw.fraquezas || []).map((x: string) => ['B', x] as [string, string]),
    ['S', 'OPORTUNIDADES'], ...(sw.oportunidades || []).map((x: string) => ['B', x] as [string, string]),
    ['S', 'AMEAÇAS'], ...(sw.ameacas || []).map((x: string) => ['B', x] as [string, string]),
    ['S', 'SÍNTESE DO DIAGNÓSTICO'], ['P', sw.sintese || ''],
    ['N', `Relatório elaborado com base no registro da consultoria gratuita realizada em ${sw.data_curta || sw.data || ''}. As informações refletem o relato da participante e não constituem orientação profissional.`],
  ]
  let text = ''
  const spans: [string, number, number, string][] = []
  for (const [tipo, t0] of paras) {
    const t = String(t0).replace(/\n+/g, ' ').trim()
    const s = u16(text) + 1
    text += t + '\n'
    spans.push([tipo, s, u16(text) + 1, t])
  }
  const fim = u16(text) + 1
  const req: any[] = [
    { insertText: { location: { index: 1 }, text } },
    { updateParagraphStyle: { range: { startIndex: 1, endIndex: fim }, paragraphStyle: { lineSpacing: 150, spaceAbove: { magnitude: 0, unit: 'PT' }, spaceBelow: { magnitude: 0, unit: 'PT' }, namedStyleType: 'NORMAL_TEXT', indentFirstLine: { magnitude: 0, unit: 'PT' }, alignment: 'JUSTIFIED' }, fields: 'lineSpacing,spaceAbove,spaceBelow,namedStyleType,indentFirstLine,alignment' } },
    { updateTextStyle: { range: { startIndex: 1, endIndex: fim }, textStyle: { weightedFontFamily: { fontFamily: 'Times New Roman', weight: 400 }, fontSize: { magnitude: 12, unit: 'PT' }, bold: false, italic: false, foregroundColor: { color: { rgbColor: { red: 0.13, green: 0.13, blue: 0.13 } } } }, fields: 'weightedFontFamily,fontSize,bold,italic,foregroundColor' } },
  ]
  const bul: [number, number][] = []
  for (const [tipo, s, e, t] of spans) {
    if (e - 1 <= s && tipo !== 'E') continue
    if (tipo === 'T') {
      req.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { alignment: 'CENTER' }, fields: 'alignment' } })
      req.push({ updateTextStyle: { range: { startIndex: s, endIndex: e - 1 }, textStyle: { bold: true, fontSize: { magnitude: 14, unit: 'PT' }, foregroundColor: { color: { rgbColor: VERDE } } }, fields: 'bold,fontSize,foregroundColor' } })
    } else if (tipo === 'ST') {
      req.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { alignment: 'CENTER' }, fields: 'alignment' } })
      req.push({ updateTextStyle: { range: { startIndex: s, endIndex: e - 1 }, textStyle: { fontSize: { magnitude: 10, unit: 'PT' }, italic: true }, fields: 'fontSize,italic' } })
    } else if (tipo === 'S') {
      req.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { spaceAbove: { magnitude: 12, unit: 'PT' }, spaceBelow: { magnitude: 4, unit: 'PT' }, alignment: 'START', borderBottom: { color: { color: { rgbColor: VERDE } }, width: { magnitude: 1, unit: 'PT' }, padding: { magnitude: 2, unit: 'PT' }, dashStyle: 'SOLID' } }, fields: 'spaceAbove,spaceBelow,alignment,borderBottom' } })
      req.push({ updateTextStyle: { range: { startIndex: s, endIndex: e - 1 }, textStyle: { bold: true, foregroundColor: { color: { rgbColor: VERDE } } }, fields: 'bold,foregroundColor' } })
    } else if (tipo === 'I') {
      req.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { alignment: 'START' }, fields: 'alignment' } })
      const k = t.indexOf(':')
      if (k > 0) req.push({ updateTextStyle: { range: { startIndex: s, endIndex: s + u16(t.slice(0, k + 1)) }, textStyle: { bold: true }, fields: 'bold' } })
    } else if (tipo === 'P') {
      req.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { indentFirstLine: { magnitude: 36, unit: 'PT' } }, fields: 'indentFirstLine' } })
    } else if (tipo === 'N') {
      req.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { spaceAbove: { magnitude: 12, unit: 'PT' } }, fields: 'spaceAbove' } })
      req.push({ updateTextStyle: { range: { startIndex: s, endIndex: e - 1 }, textStyle: { italic: true, fontSize: { magnitude: 9, unit: 'PT' }, foregroundColor: { color: { rgbColor: { red: 0.4, green: 0.4, blue: 0.4 } } } }, fields: 'italic,fontSize,foregroundColor' } })
    } else if (tipo === 'B') {
      req.push({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { spaceBelow: { magnitude: 3, unit: 'PT' } }, fields: 'spaceBelow' } })
      if (bul.length && bul[bul.length - 1][1] === s) bul[bul.length - 1][1] = e; else bul.push([s, e])
    }
  }
  for (const [s, e] of [...bul].reverse()) req.push({ createParagraphBullets: { range: { startIndex: s, endIndex: e }, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } })
  const up = await fetch(`https://docs.googleapis.com/v1/documents/${c.id}:batchUpdate`, { method: 'POST', headers: h, body: JSON.stringify({ requests: req }) })
  const u: any = await up.json().catch(() => ({}))
  if (!up.ok) throw new Error('Docs: ' + (u?.error?.message || up.status))
  // a equipe (domínio ascentria.com.br) consegue abrir e baixar o PDF
  await fetch(`https://www.googleapis.com/drive/v3/files/${c.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'domain', domain: 'ascentria.com.br', role: 'reader' }) }).catch(() => null)
  return { id: c.id as string, link: `https://docs.google.com/document/d/${c.id}/edit` }
}
