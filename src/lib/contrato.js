/** Quando o lead (quem assina além do Murilo) assinou o contrato na Autentique; null se ainda não. */
export function leadAssinouEm(deal, settings) {
  const dono = String(settings?.contract_signer_email || 'murilo@ascentria.com.br').toLowerCase()
  const lista = Array.isArray(deal?.contrato_assinaturas) ? deal.contrato_assinaturas : []
  const s = lista.find((a) => String(a?.email || '').toLowerCase() !== dono && a?.assinado_em)
  if (s) return s.assinado_em
  // contrato antigo sem a lista de assinaturas: assinado por todos
  return deal?.contrato_status === 'assinado' ? (deal.contrato_assinado_em || null) : null
}
