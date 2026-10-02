// Ligação com o Essência Plat (outro projeto Supabase): tabela venda_sessoes = "Registro de Sessões 1:1".
// Secret: PLAT_SERVICE_KEY (chave de serviço do projeto do Plat)
import { createClient } from 'npm:@supabase/supabase-js@2'

const PLAT_URL = Deno.env.get('PLAT_URL') ?? 'https://yahjhvnubmmfvxbjxmoo.supabase.co'

export function platClient() {
  const key = Deno.env.get('PLAT_SERVICE_KEY')
  return key ? createClient(PLAT_URL, key, { auth: { persistSession: false } }) : null
}

/** Primeiro link de cada tipo entre os anexos da reunião (gravação e transcrição). */
export function linksReuniao(files: any[]): { video: string; transcricao: string } {
  const url = (k: string) => (files ?? []).find((f: any) => f?.kind === k && f?.url)?.url ?? ''
  return { video: url('gravacao'), transcricao: url('transcricao') }
}

/**
 * Chegaram a gravação/transcrição da reunião: completa o registro da sessão do card (só os campos
 * ainda vazios) e, se a sessão já foi registrada, leva os links para o Essência Plat na hora.
 */
export async function levarArquivosParaSessao(admin: any, dealId: string, files: any[]) {
  try {
    const { video, transcricao } = linksReuniao(files)
    if (!video && !transcricao) return { atualizado: false }
    const { data: d } = await admin.from('deals').select('sessao_registro, plat_sessao_id').eq('id', dealId).maybeSingle()
    if (!d?.sessao_registro) return { atualizado: false } // ainda não registrada: o formulário já abre com os links
    const reg = { ...d.sessao_registro }
    let mudou = false
    if (video && !reg.video) { reg.video = video; mudou = true }
    if (transcricao && !reg.transcricao) { reg.transcricao = transcricao; mudou = true }
    if (!mudou) return { atualizado: false }
    await admin.from('deals').update({ sessao_registro: reg }).eq('id', dealId)
    const plat = platClient()
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
