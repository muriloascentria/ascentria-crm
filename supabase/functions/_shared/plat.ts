// Ligação com o Essência Plat (outro projeto Supabase): tabela venda_sessoes = "Registro de Sessões 1:1".
// Secret: PLAT_SERVICE_KEY (chave de serviço do projeto do Plat)
import { createClient } from 'npm:@supabase/supabase-js@2'

const PLAT_URL = Deno.env.get('PLAT_URL') ?? 'https://yahjhvnubmmfvxbjxmoo.supabase.co'

export function platClient() {
  const key = Deno.env.get('PLAT_SERVICE_KEY')
  return key ? createClient(PLAT_URL, key, { auth: { persistSession: false } }) : null
}

/** Links da reunião: gravação e transcrição (sem a transcrição do Meet, vale o documento de anotações do Gemini,
 *  que traz o resumo e a transcrição da conversa). */
export function linksReuniao(files: any[]): { video: string; transcricao: string } {
  const url = (k: string) => (files ?? []).find((f: any) => f?.kind === k && f?.url)?.url ?? ''
  return { video: url('gravacao'), transcricao: url('transcricao') || url('anotacoes') }
}

const VENDEDORES = ['Adriana', 'Carmem', 'Carmem e Diego', 'Diego', 'Viviane']
const SEM_OBJECAO = 'Não foram registradas objeções.'
const SEM_OBSERVACAO = 'Não foram registradas observações.'
const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null)

/**
 * Chegaram a gravação/transcrição da reunião:
 *  - sessão já registrada: completa os links vazios no card e na mesma linha do Essência Plat;
 *  - ainda não registrada: cria a linha no Registro de Sessões 1:1 do Plat com o que já se sabe
 *    (data, lead, WhatsApp, vendedora, links). A consultora completa depois no card e a MESMA linha é atualizada.
 */
export async function levarArquivosParaSessao(admin: any, dealId: string, files: any[]) {
  try {
    const { video, transcricao } = linksReuniao(files)
    if (!video && !transcricao) return { atualizado: false }
    const { data: d } = await admin.from('deals')
      .select('title, meeting_date, sessao_registro, plat_sessao_id, seller:calendar_sellers(name), contact:contacts(name, phone, wa_id)')
      .eq('id', dealId).maybeSingle()
    if (!d) return { atualizado: false }
    const plat = platClient()

    if (!d.plat_sessao_id) {
      if (!plat) return { atualizado: false }
      const primeiro = String(d.seller?.name ?? '').trim().split(/\s+/)[0].toLowerCase()
      const reg: Record<string, any> = {
        data: d.meeting_date || '', lead: d.contact?.name || d.title || '',
        whatsapp: d.contact?.wa_id ? '+' + d.contact.wa_id : d.contact?.phone || '',
        vendedor: VENDEDORES.find((v) => v.toLowerCase() === primeiro) || '',
        produto: 'Mentoria Essência', upsell: false, formato: 'Videochamada', presenca: '', resultado: '', valor: '',
        objecao1: '', objecao2: '', observacoes: '', contrato: '',
        ...(d.sessao_registro ?? {}),
      }
      reg.video = reg.video || video
      reg.transcricao = reg.transcricao || transcricao
      const { data: ult } = await plat.from('venda_sessoes').select('numero').not('numero', 'is', null).order('numero', { ascending: false }).limit(1).maybeSingle()
      const { data: ins, error } = await plat.from('venda_sessoes').insert({
        numero: (ult?.numero ?? 0) + 1, data_sessao: reg.data || null, data_texto: dataBR(reg.data),
        lead_nome: reg.lead, whatsapp: reg.whatsapp || null, vendedor: reg.vendedor || null,
        produto: reg.produto || null, upsell: !!reg.upsell, formato: reg.formato || null,
        presenca: reg.presenca || null, resultado: reg.resultado || null,
        objecoes: SEM_OBJECAO, objecoes2: SEM_OBJECAO, observacoes: SEM_OBSERVACAO,
        video_venda: reg.video || null, transcricao: reg.transcricao || null,
      }).select('id').single()
      if (error || !ins) { console.error('plat: criar sessão', error?.message); return { atualizado: false } }
      // sessao_salva_em fica vazio: a aba continua pedindo para a consultora completar e salvar
      await admin.from('deals').update({ sessao_registro: reg, plat_sessao_id: ins.id }).eq('id', dealId)
      return { atualizado: true, criado_no_plat: true }
    }

    const reg = { ...(d.sessao_registro ?? {}) }
    let mudou = false
    if (video && !reg.video) { reg.video = video; mudou = true }
    if (transcricao && !reg.transcricao) { reg.transcricao = transcricao; mudou = true }
    if (!mudou) return { atualizado: false }
    await admin.from('deals').update({ sessao_registro: reg }).eq('id', dealId)
    if (plat && d.plat_sessao_id) {
      const { error } = await plat.from('venda_sessoes')
        .update({ video_venda: reg.video || null, transcricao: reg.transcricao || null }).eq('id', d.plat_sessao_id)
      if (error) console.error('plat: arquivos da reunião', error.message)
    }
    return { atualizado: true }
  } catch (e) {
    console.error('levarArquivosParaSessao', (e as Error).message)
    return { atualizado: false }
  }
}
