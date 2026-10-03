// Autentique (assinatura eletrônica) — API GraphQL v2.
// Secret: AUTENTIQUE_TOKEN
import { platClient } from './plat.ts'

const API = 'https://api.autentique.com.br/v2/graphql'

export const autentiqueOn = () => !!Deno.env.get('AUTENTIQUE_TOKEN')

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('AUTENTIQUE_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || data.errors?.length) throw new Error('Autentique: ' + (data.errors?.[0]?.message || data.message || res.status))
  return data.data
}

/** Cria o documento e dispara os e-mails de assinatura. */
export async function criarDocumento(pdf: Uint8Array, nome: string, signers: { email: string; name?: string }[], mensagem: string) {
  const query = `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
    createDocument(document: $document, signers: $signers, file: $file) {
      id name signatures { public_id name email action { name } link { short_link } }
    }
  }`
  const operations = {
    query,
    variables: {
      document: { name: nome, message: mensagem, reminder: 'WEEKLY', refusable: true },
      signers: signers.map((s) => ({ email: s.email, action: 'SIGN', ...(s.name ? { name: s.name } : {}) })),
      file: null,
    },
  }
  const form = new FormData()
  form.append('operations', JSON.stringify(operations))
  form.append('map', JSON.stringify({ file: ['variables.file'] }))
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), `${nome}.pdf`)
  const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('AUTENTIQUE_TOKEN')}` }, body: form })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || data.errors?.length) throw new Error('Autentique: ' + (data.errors?.[0]?.message || data.message || res.status))
  return data.data.createDocument
}

export async function buscarDocumento(id: string) {
  const d = await gql(`query { document(id: ${JSON.stringify(id)}) {
    id name files { original signed }
    signatures { public_id name email action { name } signed { created_at } rejected { created_at } viewed { created_at } }
  } }`)
  return d.document
}

export async function apagarDocumento(id: string) {
  await gql(`mutation { deleteDocument(id: ${JSON.stringify(id)}) }`)
}

/** Resumo para o card: quem já assinou, se alguém recusou e o PDF assinado. */
export function resumo(doc: any) {
  const sigs = (doc?.signatures ?? []).filter((s: any) => !s.action || s.action.name === 'SIGN')
  const assinaturas = sigs.map((s: any) => ({
    nome: s.name || null, email: s.email || null,
    assinado_em: s.signed?.created_at ?? null, recusado_em: s.rejected?.created_at ?? null, visto_em: s.viewed?.created_at ?? null,
  }))
  const recusado = assinaturas.some((a: any) => a.recusado_em)
  const todos = assinaturas.length > 0 && assinaturas.every((a: any) => a.assinado_em)
  return { assinaturas, status: recusado ? 'recusado' : todos ? 'assinado' : 'enviado', pdf: doc?.files?.signed ?? null }
}

/** Grava o andamento no card; quando todos assinam, leva o PDF assinado para o registro da sessão e para o Plat. */
export async function aplicarAndamento(admin: any, dealId: string, doc: any) {
  const r = resumo(doc)
  const { data: d } = await admin.from('deals').select('contrato_status, contrato_url, sessao_registro, plat_sessao_id').eq('id', dealId).single()
  const patch: Record<string, unknown> = { contrato_assinaturas: r.assinaturas, contrato_status: r.status }
  if (r.status === 'assinado') {
    const link = r.pdf || d?.contrato_url
    patch.contrato_pdf_url = r.pdf
    if (d?.contrato_status !== 'assinado') {
      const ultima = r.assinaturas.map((a: any) => a.assinado_em).sort().pop()
      patch.contrato_assinado_em = ultima ?? new Date().toISOString()
      if (d?.sessao_registro) patch.sessao_registro = { ...d.sessao_registro, contrato: link }
      const plat = platClient()
      if (plat && d?.plat_sessao_id && link) await plat.from('venda_sessoes').update({ contrato_texto: link }).eq('id', d.plat_sessao_id)
      await admin.from('activities').insert({ type: 'note', title: 'Contrato assinado por todos (Autentique)', description: link, deal_id: dealId, done: true, done_at: new Date().toISOString() })
    }
  }
  await admin.from('deals').update(patch).eq('id', dealId)
  return r
}
