// Contrato da Mentoria Essência a partir do card do lead.
//
// Ações (body.action):
//   gerar    { deal_id, dados } → copia o modelo (Google Docs) para o Drive da vendedora, troca os campos
//                                {{...}} pelos dados do lead (valores também por extenso), tira o destaque
//                                amarelo dos campos e guarda o link no card.
//   assinado { deal_id }        → marca o contrato como assinado e leva o link para o registro da sessão
//                                (e para o "Link do contrato" no Essência Plat, se a sessão já estiver lá).
//
// As assinaturas são pedidas pela vendedora no próprio Google Docs (Ferramentas → Assinatura eletrônica):
// o Google não oferece API para disparar esse pedido.
//
// Conta de serviço do Google (a mesma da agenda), com delegação em todo o domínio e os escopos
// drive + documents. Secret: GOOGLE_SERVICE_ACCOUNT_JSON
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/wa.ts'
import { platClient } from '../_shared/plat.ts'

const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents'
const DRIVE = 'https://www.googleapis.com/drive/v3/files'
const DOCS = 'https://docs.googleapis.com/v1/documents'
const PASTA = 'Contratos eCRM'

type SA = { client_email: string; private_key: string; token_uri?: string }

function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleToken(sa: SA, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, sub: subject, scope: SCOPES, aud, iat: now, exp: now + 3600 }))}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = String(data.error_description || data.error || res.status)
    if (/unauthorized_client|not authorized/i.test(e)) throw new Error('O Google ainda não liberou o Drive para o CRM. No admin.google.com, a delegação da conta de serviço precisa dos escopos drive e documents (além de calendar.events).')
    if (/invalid_grant/i.test(e)) throw new Error(`O Google não reconheceu a conta ${subject}.`)
    throw new Error('Google: ' + e)
  }
  return data.access_token
}

async function g(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) { const err: any = new Error(data?.error?.message || `Google ${res.status}`); err.status = res.status; throw err }
  return data
}

// ---------- números por extenso (pt-BR) ----------
const UN = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const DZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const CT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos']
function ate999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'
  const c = Math.floor(n / 100), r = n % 100, p: string[] = []
  if (c) p.push(CT[c])
  if (r) p.push(r < 20 ? UN[r] : DZ[Math.floor(r / 10)] + (r % 10 ? ' e ' + UN[r % 10] : ''))
  return p.join(' e ')
}
export function extenso(n: number): string {
  n = Math.floor(Math.abs(n))
  if (n === 0) return 'zero'
  const grupos = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']]
  const partes: { txt: string; v: number }[] = []
  let i = 0
  while (n > 0 && i < grupos.length) {
    const v = n % 1000
    if (v) {
      const nome = i === 0 ? '' : i === 1 ? 'mil' : (v === 1 ? grupos[i][0] : grupos[i][1])
      const num = i === 1 && v === 1 ? '' : ate999(v)
      partes.unshift({ txt: [num, nome].filter(Boolean).join(' '), v })
    }
    n = Math.floor(n / 1000); i++
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda (ex.: mil e quinhentos, dois mil e vinte)
  return partes.map((p, k) => (k > 0 && k === partes.length - 1 && (p.v < 100 || p.v % 100 === 0) ? 'e ' : '') + p.txt).join(' ').replace(/\s+/g, ' ').trim()
}
function reaisExtenso(v: number): string {
  const inteiro = Math.floor(v + 1e-9), cent = Math.round((v - inteiro) * 100)
  const p: string[] = []
  if (inteiro) p.push(`${extenso(inteiro)}${inteiro % 1000000 === 0 && inteiro >= 1000000 ? ' de' : ''} ${inteiro === 1 ? 'real' : 'reais'}`)
  if (cent) p.push(`${extenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`)
  return p.length ? p.join(' e ') : 'zero reais'
}
function valorNum(t: unknown): number | null {
  let s = String(t ?? '').replace(/[^\d,.-]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if ((s.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const dataExtenso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${String(d).padStart(2, '0')} de ${MESES[m - 1]} de ${y}` }
const mesAno = (ym: string) => { const [y, m] = ym.split('-').map(Number); const n = MESES[m - 1] ?? ''; return `${n.charAt(0).toUpperCase()}${n.slice(1)} de ${y}` }
const txt = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { data: me } = await admin.from('profiles').select('email, active').eq('id', user.id).single()
  if (!me?.active) return json({ error: 'Usuário inativo' }, 403)

  const b = await req.json().catch(() => ({}))
  // o negócio é lido com as permissões de quem pede
  const { data: deal } = await userClient.from('deals')
    .select('id, title, seller_id, contrato_doc_id, contrato_url, contrato_status, sessao_registro, plat_sessao_id, seller:calendar_sellers(name, email)')
    .eq('id', String(b.deal_id ?? '')).maybeSingle()
  if (!deal) return json({ ok: false, error: 'Negócio não encontrado.' })
  const d: any = deal

  try {
    if (b.action === 'assinado') {
      const agora = new Date().toISOString()
      const patch: Record<string, unknown> = { contrato_status: b.desfazer ? 'gerado' : 'assinado', contrato_assinado_em: b.desfazer ? null : agora }
      // o link do contrato vai para o registro da sessão e para o Plat
      if (!b.desfazer && d.contrato_url) {
        if (d.sessao_registro) patch.sessao_registro = { ...d.sessao_registro, contrato: d.contrato_url }
        const plat = platClient()
        if (plat && d.plat_sessao_id) await plat.from('venda_sessoes').update({ contrato_texto: d.contrato_url }).eq('id', d.plat_sessao_id)
      }
      const { error } = await userClient.from('deals').update(patch).eq('id', d.id)
      if (error) return json({ ok: false, error: error.message })
      return json({ ok: true, status: patch.contrato_status })
    }

    if (b.action !== 'gerar') return json({ ok: false, error: 'Ação desconhecida' }, 400)

    const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    let sa: SA | null = null
    try { sa = raw ? JSON.parse(raw) : null } catch { sa = null }
    if (!sa?.client_email || !sa?.private_key) return json({ ok: false, error: 'A conta do Google ainda não foi conectada ao CRM.' })

    const { data: st } = await admin.from('org_settings').select('contract_template_id, contract_signer_email').eq('id', 1).single()
    const modelo = st?.contract_template_id
    if (!modelo) return json({ ok: false, error: 'Modelo de contrato não configurado.' })

    // ---------- dados ----------
    const x = b.dados ?? {}
    const nome = txt(x.nome, 200)
    if (!nome) return json({ ok: false, error: 'Informe o nome completo do lead.' })
    const total = valorNum(x.valor_total), entrada = valorNum(x.entrada) ?? 0, parcela = valorNum(x.valor_parcela) ?? 0
    const nParc = Math.max(0, Math.floor(Number(String(x.num_parcelas ?? '').replace(/\D/g, '')) || 0))
    if (total == null) return json({ ok: false, error: 'Informe o valor total.' })
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
    const dataIso = /^\d{4}-\d{2}-\d{2}$/.test(txt(x.data)) ? txt(x.data) : hoje
    const ini = /^\d{4}-\d{2}$/.test(txt(x.vigencia_inicio)) ? txt(x.vigencia_inicio) : dataIso.slice(0, 7)
    const fim = /^\d{4}-\d{2}$/.test(txt(x.vigencia_fim)) ? txt(x.vigencia_fim) : `${Number(ini.slice(0, 4)) + 1}${ini.slice(4)}`
    const campos: Record<string, string> = {
      NOME_COMPLETO: nome,
      CPF: txt(x.cpf, 20),
      ENDERECO: txt(x.endereco, 300),
      BAIRRO: txt(x.bairro, 120),
      CIDADE_UF: txt(x.cidade_uf, 120),
      VALOR_TOTAL: brl(total), VALOR_TOTAL_EXTENSO: reaisExtenso(total),
      FORMA_PAGAMENTO: txt(x.forma_pagamento, 120) || '—',
      ENTRADA: brl(entrada), ENTRADA_EXTENSO: reaisExtenso(entrada),
      NUM_PARCELAS: String(nParc), NUM_PARCELAS_EXTENSO: extenso(nParc),
      VALOR_PARCELA: brl(parcela), VALOR_PARCELA_EXTENSO: reaisExtenso(parcela),
      VENCIMENTOS: txt(x.vencimentos, 300) || '—',
      VIGENCIA_INICIO: mesAno(ini), VIGENCIA_FIM: mesAno(fim),
      DATA_CONTRATO: dataExtenso(dataIso),
    }

    // ---------- em nome de quem (o contrato fica no Drive dela e o pedido de assinatura sai do e-mail dela) ----------
    const { data: vendedoras } = await admin.from('calendar_sellers').select('email').eq('active', true)
    const emails = (vendedoras ?? []).map((s: any) => String(s.email).toLowerCase())
    const eu = String(me.email ?? '').toLowerCase()
    const dono = emails.includes(eu) ? eu : (d.seller?.email ? String(d.seller.email).toLowerCase() : eu)
    if (!dono.endsWith('@ascentria.com.br')) return json({ ok: false, error: 'Não sei em qual Drive criar o contrato (a vendedora do encontro precisa ter e-mail @ascentria.com.br).' })
    const tk = await googleToken(sa, dono)

    // pasta "Contratos eCRM" no Drive da vendedora
    const q = encodeURIComponent(`name='${PASTA}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`)
    const achou = await g(tk, `${DRIVE}?q=${q}&fields=files(id)&pageSize=1`)
    const pasta = achou.files?.[0]?.id ?? (await g(tk, `${DRIVE}?fields=id`, { method: 'POST', body: JSON.stringify({ name: PASTA, mimeType: 'application/vnd.google-apps.folder' }) })).id

    // cópia do modelo (se a vendedora ainda não tem acesso ao modelo, o dono do modelo libera leitura para ela)
    const titulo = `Contrato Mentoria Essência - ${nome} - ${dataIso.split('-').reverse().join('/')}`
    const copiar = () => g(tk, `${DRIVE}/${encodeURIComponent(modelo)}/copy?fields=id,webViewLink&supportsAllDrives=true`, { method: 'POST', body: JSON.stringify({ name: titulo, parents: [pasta] }) })
    let doc: any
    try { doc = await copiar() } catch (e) {
      if ((e as any).status !== 404 && (e as any).status !== 403) throw e
      const donoModelo = String(st?.contract_signer_email || 'murilo@ascentria.com.br')
      const tkModelo = await googleToken(sa, donoModelo)
      await g(tkModelo, `${DRIVE}/${encodeURIComponent(modelo)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, { method: 'POST', body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: dono }) })
      doc = await copiar()
    }

    // troca os campos e tira o destaque amarelo
    await g(tk, `${DOCS}/${doc.id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: Object.entries(campos).map(([k, v]) => ({ replaceAllText: { containsText: { text: `{{${k}}}`, matchCase: true }, replaceText: v } })) }),
    })
    const conteudo = await g(tk, `${DOCS}/${doc.id}?fields=body(content(startIndex,endIndex,paragraph(elements(startIndex,endIndex,textRun(textStyle(backgroundColor))))))`)
    const ranges: { s: number; e: number }[] = []
    for (const el of conteudo.body?.content ?? []) for (const pe of el.paragraph?.elements ?? []) {
      const bg = pe.textRun?.textStyle?.backgroundColor?.color?.rgbColor
      if (bg && pe.startIndex != null && pe.endIndex > pe.startIndex) ranges.push({ s: pe.startIndex, e: pe.endIndex })
    }
    if (ranges.length) {
      await g(tk, `${DOCS}/${doc.id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: ranges.map((r) => ({ updateTextStyle: { range: { startIndex: r.s, endIndex: r.e }, textStyle: {}, fields: 'backgroundColor' } })) }),
      })
    }

    // contrato anterior ainda não assinado: vai para a lixeira (o novo substitui)
    if (d.contrato_doc_id && d.contrato_status !== 'assinado' && d.contrato_doc_id !== doc.id) {
      await g(tk, `${DRIVE}/${encodeURIComponent(d.contrato_doc_id)}?supportsAllDrives=true`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) }).catch(() => null)
    }

    const url = doc.webViewLink || `https://docs.google.com/document/d/${doc.id}/edit`
    const agora = new Date().toISOString()
    const dados = { ...x, nome, data: dataIso, vigencia_inicio: ini, vigencia_fim: fim, dono }
    const { error: uErr } = await userClient.from('deals').update({
      contrato: dados, contrato_doc_id: doc.id, contrato_url: url, contrato_status: 'gerado', contrato_gerado_em: agora, contrato_assinado_em: null,
    }).eq('id', d.id)
    if (uErr) return json({ ok: false, error: 'O contrato foi criado, mas não consegui salvar no card: ' + uErr.message, url })
    await admin.from('activities').insert({
      type: 'note', title: 'Contrato gerado', description: `${titulo}\n${url}`,
      deal_id: d.id, done: true, done_at: agora, created_by: user.id, assigned_to: user.id,
    })
    return json({ ok: true, url, doc_id: doc.id, dono, signatario_contratado: st?.contract_signer_email || 'murilo@ascentria.com.br' })
  } catch (e) {
    console.error('contrato', (e as Error).message)
    return json({ ok: false, error: (e as Error).message })
  }
})
