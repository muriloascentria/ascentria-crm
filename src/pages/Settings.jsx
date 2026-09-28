import { useEffect, useLayoutEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { Avatar, ConfirmButton, Field, Modal } from '../components/ui'
import { ACTIVITY_TYPES, ROLES, fmtDate, slugify } from '../lib/utils'
import { QUICK_STAGES, STAGE_ROLES, quickStageLabel, splitParts, connectWaba, instagramWebhookUrl, registerNumber, runCadenceNow, verifyNumberStep, webhookUrl } from '../lib/wa'
import { UserSelect } from '../components/ui'
import { DEMO } from '../lib/supabase'
import WhatsAppPanel from '../components/WhatsAppPanel'
import { callCalendar } from '../lib/calendar'

const TABS = [['brand', 'Marca'], ['pipelines', 'Funis e etapas'], ['whatsapp', 'WhatsApp'], ['quick', 'Mensagens prontas'], ['agenda', 'Agenda Google'], ['fields', 'Campos personalizados'], ['users', 'Usuários e permissões'], ['automations', 'Automações']]

export default function Settings() {
  const [tab, setTab] = useState('brand')
  return (
    <>
      <div className="page-head"><h1>Configurações</h1></div>
      <div className="tabs">{TABS.map(([k, t]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{t}</button>)}</div>
      {tab === 'brand' && <Brand />}
      {tab === 'pipelines' && <Pipelines />}
      {tab === 'fields' && <Fields />}
      {tab === 'quick' && <QuickReplies />}
      {tab === 'agenda' && <Agenda />}
      {tab === 'users' && <Users />}
      {tab === 'automations' && <Automations />}
      {tab === 'whatsapp' && <WhatsApp />}
    </>
  )
}

/* ------------------------------------------------------------------ Marca */
function Brand() {
  const { settings, reload, toast } = useApp()
  const [f, setF] = useState(settings)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const setLabel = (k, v) => setF((x) => ({ ...x, labels: { ...x.labels, [k]: v } }))
  const save = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('org_settings').update({
      company_name: f.company_name, logo_url: f.logo_url || null, primary_color: f.primary_color, accent_color: f.accent_color,
      currency: f.currency, seller_visibility: f.seller_visibility, labels: f.labels, updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) return toast(error.message, 'err')
    toast('Configurações salvas'); reload()
  }
  return (
    <form onSubmit={save} className="grid2" style={{ alignItems: 'start' }}>
      <div className="card stack" style={{ gap: 12 }}>
        <h2>Identidade</h2>
        <Field label="Nome da empresa"><input className="input" value={f.company_name} onChange={(e) => set('company_name', e.target.value)} required /></Field>
        <Field label="URL do logo" hint="Imagem quadrada, PNG/SVG. Deixe vazio para usar a inicial."><input className="input" value={f.logo_url || ''} onChange={(e) => set('logo_url', e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Cor principal"><div className="row"><input type="color" value={f.primary_color} onChange={(e) => set('primary_color', e.target.value)} /><input className="input" value={f.primary_color} onChange={(e) => set('primary_color', e.target.value)} /></div></Field>
          <Field label="Cor de destaque"><div className="row"><input type="color" value={f.accent_color} onChange={(e) => set('accent_color', e.target.value)} /><input className="input" value={f.accent_color} onChange={(e) => set('accent_color', e.target.value)} /></div></Field>
        </div>
        <Field label="Moeda"><select className="select" value={f.currency} onChange={(e) => set('currency', e.target.value)}><option value="BRL">Real (R$)</option><option value="USD">Dólar (US$)</option><option value="EUR">Euro (€)</option></select></Field>
        <Field label="Visibilidade para vendedores" hint="Gestores e administradores sempre veem tudo.">
          <select className="select" value={f.seller_visibility} onChange={(e) => set('seller_visibility', e.target.value)}>
            <option value="all">Vendedores veem todos os registros</option>
            <option value="own">Vendedores veem apenas os próprios registros</option>
          </select>
        </Field>
      </div>
      <div className="card stack" style={{ gap: 12 }}>
        <h2>Nomes das seções</h2>
        <p className="small muted">Adapte a linguagem do sistema ao seu negócio (ex.: "Alunos" em vez de "Contatos").</p>
        {Object.entries(f.labels).filter(([k]) => k !== 'companies').map(([k, v]) => <Field key={k} label={k}><input className="input" value={v} onChange={(e) => setLabel(k, e.target.value)} /></Field>)}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary">Salvar</button></div>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ Funis */
function Pipelines() {
  const { pipelines, stages, reload, toast } = useApp()
  const [sel, setSel] = useState(pipelines[0]?.id)
  const [draft, setDraft] = useState([])
  const [cad, setCad] = useState(null) // índice da etapa com editor de cadência aberto
  useLayoutEffect(() => { setDraft(stages.filter((s) => s.pipeline_id === sel).map((s) => ({ ...s }))) }, [stages, sel])
  const pipe = pipelines.find((p) => p.id === sel)

  const addPipeline = async () => {
    const name = window.prompt('Nome do novo funil:'); if (!name) return
    const { data, error } = await supabase.from('pipelines').insert({ name, position: pipelines.length }).select().single()
    if (error) return toast(error.message, 'err')
    await supabase.from('stages').insert([
      { pipeline_id: data.id, name: 'Novo', position: 0, color: '#babec6', probability: 10 },
      { pipeline_id: data.id, name: 'Em andamento', position: 1, color: '#818a66', probability: 50 },
      { pipeline_id: data.id, name: 'Ganho', position: 2, color: '#2e381a', probability: 100, kind: 'won' },
      { pipeline_id: data.id, name: 'Perdido', position: 3, color: '#a8432f', probability: 0, kind: 'lost' },
    ])
    await reload(); setSel(data.id)
  }
  const renamePipeline = async () => {
    const name = window.prompt('Novo nome:', pipe.name); if (!name) return
    await supabase.from('pipelines').update({ name }).eq('id', sel); reload()
  }
  const makeDefault = async () => {
    await supabase.from('pipelines').update({ is_default: false }).neq('id', sel)
    await supabase.from('pipelines').update({ is_default: true }).eq('id', sel); reload()
  }
  const setDailyLimit = async (m) => { await supabase.from('pipelines').update({ daily_limit: Number(m) }).eq('id', sel); reload() }
  const setArchiveMonths = async (m) => { await supabase.from('pipelines').update({ archive_months: Number(m) }).eq('id', sel); reload() }
  const setReactivateTo = async (v) => { await supabase.from('pipelines').update({ reactivate_to_pipeline_id: v || null }).eq('id', sel); reload() }
  const removePipeline = async () => {
    const { error } = await supabase.from('pipelines').delete().eq('id', sel)
    if (error) return toast('Não é possível excluir: existem negócios neste funil.', 'err')
    setSel(pipelines.find((p) => p.id !== sel)?.id); reload()
  }
  const upd = (i, k, v) => setDraft((d) => d.map((s, j) => (j === i ? { ...s, [k]: v } : s)))
  const move = (i, dir) => setDraft((d) => { const c = [...d]; const j = i + dir; if (j < 0 || j >= c.length) return d; [c[i], c[j]] = [c[j], c[i]]; return c })
  const addStage = () => setDraft((d) => [...d, { id: 'new-' + Date.now(), pipeline_id: sel, name: 'Nova etapa', color: '#818a66', probability: 50, kind: 'open' }])
  const removeStage = async (i) => {
    const s = draft[i]
    if (!String(s.id).startsWith('new-')) {
      const { error } = await supabase.from('stages').delete().eq('id', s.id)
      if (error) return toast('Não é possível excluir: existem negócios nesta etapa. Mova-os antes.', 'err')
    }
    setDraft((d) => d.filter((_, j) => j !== i))
  }
  const save = async () => {
    for (let i = 0; i < draft.length; i++) {
      const s = draft[i]
      const row = {
        pipeline_id: sel, name: s.name, position: i, color: s.color, probability: Number(s.probability), kind: s.kind,
        role: s.role || null, advance_after_days: s.role === 'day' && s.advance_after_days ? Number(s.advance_after_days) : null,
        message_text: s.message_text || null, wa_template_name: s.wa_template_name || null, wa_template_lang: s.wa_template_lang || 'pt_BR', auto_send: !!s.auto_send,
      }
      const { error } = String(s.id).startsWith('new-') ? await supabase.from('stages').insert(row) : await supabase.from('stages').update(row).eq('id', s.id)
      if (error) return toast(error.message, 'err')
    }
    toast('Etapas salvas'); reload()
  }

  return (
    <div className="grid2" style={{ gridTemplateColumns: '260px 1fr', alignItems: 'start' }}>
      <div className="card stack">
        <div className="between"><h2>Funis</h2><button className="btn sm" onClick={addPipeline}>+ Novo</button></div>
        <div className="list-edit">
          {pipelines.map((p) => (
            <button key={p.id} className={'item' + (p.id === sel ? ' active' : '')} style={{ cursor: 'pointer', textAlign: 'left', borderColor: p.id === sel ? 'var(--primary)' : undefined }} onClick={() => setSel(p.id)}>
              <span className="grow">{p.name}</span>{p.is_default && <span className="chip">padrão</span>}
            </button>
          ))}
        </div>
      </div>
      {pipe && (
        <div className="card stack" style={{ gap: 12 }}>
          <div className="between wrap">
            <h2>{pipe.name}</h2>
            <div className="row">
              <button className="btn sm" onClick={renamePipeline}>Renomear</button>
              {!pipe.is_default && <button className="btn sm" onClick={makeDefault}>Tornar padrão</button>}
              {pipelines.length > 1 && <ConfirmButton onConfirm={removePipeline}>Excluir funil</ConfirmButton>}
            </div>
          </div>
          <p className="small muted">Etapas do tipo <b>Ganho</b> e <b>Perdido</b> fecham o negócio automaticamente ao receber um card. A probabilidade alimenta a previsão ponderada do painel. O botão <b>⚙</b> define a função da coluna na sequência de WhatsApp (dia, responsivo, perdido temporário, reativar), a mensagem do dia e o avanço automático.</p>
          {draft.some((s) => s.role === 'archived') && (
            <div className="row small wrap"><span>Leads nas colunas de perdido, após</span><input className="input" type="number" min="1" defaultValue={pipe.archive_months ?? 4} onBlur={(e) => Number(e.target.value) !== pipe.archive_months && setArchiveMonths(e.target.value)} style={{ width: 70 }} /><span>meses, vão para</span>
              <select className="select" style={{ width: 'auto' }} value={pipe.reactivate_to_pipeline_id || ''} onChange={(e) => setReactivateTo(e.target.value)}>
                <option value="">o Dia 1 deste funil</option>
                {pipelines.filter((p) => p.id !== pipe.id && stages.some((s) => s.pipeline_id === p.id && s.role === 'day')).map((p) => <option key={p.id} value={p.id}>o Dia 1 do funil {p.name}</option>)}
              </select>
              <span style={{ marginLeft: 12 }}>Limite diário de envios (Meta):</span><input className="input" type="number" min="1" defaultValue={pipe.daily_limit ?? 250} onBlur={(e) => Number(e.target.value) !== pipe.daily_limit && setDailyLimit(e.target.value)} style={{ width: 90 }} /></div>
          )}
          <div className="list-edit">
            {draft.map((s, i) => (
              <div key={s.id} className="item">
                <div className="stack" style={{ gap: 2 }}><button className="btn ghost icon sm" onClick={() => move(i, -1)}>▲</button><button className="btn ghost icon sm" onClick={() => move(i, 1)}>▼</button></div>
                <input type="color" value={s.color} onChange={(e) => upd(i, 'color', e.target.value)} />
                <input className="input" value={s.name} onChange={(e) => upd(i, 'name', e.target.value)} style={{ flex: 2 }} />
                <input className="input" type="number" min="0" max="100" value={s.probability} onChange={(e) => upd(i, 'probability', e.target.value)} style={{ width: 80 }} title="Probabilidade %" />
                <select className="select" value={s.kind} onChange={(e) => upd(i, 'kind', e.target.value)} style={{ width: 120 }}>
                  <option value="open">Aberta</option><option value="won">Ganho</option><option value="lost">Perdido</option>
                </select>
                <button className={'btn sm' + (s.role ? ' primary' : '')} onClick={() => setCad(cad === i ? null : i)} title="Regras da sequência de WhatsApp">⚙{s.role === 'day' ? ` ${s.advance_after_days || '–'}d` : ''}</button>
                <button className="btn ghost sm" onClick={() => removeStage(i)} title="Excluir">🗑</button>
              </div>
            ))}
          </div>
          {cad !== null && draft[cad] && <StageCadenceEditor s={draft[cad]} onChange={(k, v) => upd(cad, k, v)} onClose={() => setCad(null)} />}
          <div className="between"><button className="btn sm" onClick={addStage}>+ Etapa</button><button className="btn primary" onClick={save}>Salvar etapas</button></div>
        </div>
      )}
    </div>
  )
}

function StageCadenceEditor({ s, onChange, onClose }) {
  return (
    <div className="card stack" style={{ background: 'var(--surface-2)', gap: 10 }}>
      <div className="between"><h3>Coluna "{s.name}" na sequência de WhatsApp</h3><button className="close" onClick={onClose}>×</button></div>
      <Field label="Função da coluna">
        <select className="select" value={s.role || ''} onChange={(e) => onChange('role', e.target.value || null)}>
          {Object.entries(STAGE_ROLES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </Field>
      {s.role === 'day' && (<>
        <div className="grid2">
          <Field label="Avançar para a próxima coluna após (dias sem resposta)" hint="Na última coluna de dia, o lead vai para a primeira coluna de perdido (Perdido cadência)."><input className="input" type="number" min="1" value={s.advance_after_days ?? ''} onChange={(e) => onChange('advance_after_days', e.target.value)} /></Field>
          <Field label="Como enviar a mensagem do dia">
            <select className="select" value={s.auto_send ? '1' : '0'} onChange={(e) => onChange('auto_send', e.target.value === '1')}>
              <option value="0">Criar tarefa para eu enviar manualmente</option>
              <option value="1">Enviar automaticamente pela API da Meta</option>
            </select>
          </Field>
        </div>
        <Field label="Mensagem do dia" hint="Variáveis: {{primeiro_nome}}, {{nome}}. Texto livre só é aceito pela Meta nas 24h após a última mensagem do lead no WhatsApp. Lead vindo do Instagram ainda não escreveu no WhatsApp, então até o Dia 1 sai como template — o texto aqui vira o roteiro da tarefa quando o envio é manual."><textarea className="textarea" value={s.message_text || ''} onChange={(e) => onChange('message_text', e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Template aprovado na Meta (para fora da janela de 24h)" hint="Nome exato do template. A variável {{1}} recebe o primeiro nome."><input className="input" value={s.wa_template_name || ''} onChange={(e) => onChange('wa_template_name', e.target.value)} placeholder="mentoria_dia_2" /></Field>
          <Field label="Idioma do template"><input className="input" value={s.wa_template_lang || 'pt_BR'} onChange={(e) => onChange('wa_template_lang', e.target.value)} /></Field>
        </div>
      </>)}
      {s.role && s.role !== 'day' && <p className="small muted">{{ inbox: 'Leads do Instagram (e novos leads em geral) entram aqui automaticamente, sem envio. Você move para o Dia 1 arrastando ou pelo botão "Mover em lote", respeitando o limite diário da Meta.', responsive: 'Quando o lead responde (webhook da Meta), o negócio é movido para esta coluna e a sequência para.', archived: 'Perdido temporário: o lead recebe a data de retorno e, quando ela chega, volta sozinho ao primeiro dia da sequência. A primeira coluna deste tipo (Perdido cadência) recebe automaticamente quem termina a sequência sem responder; as demais (desinteresse, apresentado) você move manualmente.', reactivate: 'Opcional. Se existir uma coluna com esta função, o lead perdido vem para cá, após o prazo, (com a tarefa "Retomar contato") em vez de voltar ao Dia 1.' }[s.role]}</p>}
      <div className="small muted">Lembre de clicar em <b>Salvar etapas</b>.</div>
    </div>
  )
}

/* ------------------------------------------------------------------ WhatsApp */
function WhatsApp() {
  const { settings, reload, toast, waNumbers } = useApp()
  const [busy, setBusy] = useState(false)
  const [testContact, setTestContact] = useState(null)
  const [contacts, setContacts] = useState([])
  const [editing, setEditing] = useState(null)
  useEffect(() => { supabase.from('contacts').select('id,name,phone,wa_id').order('name').then(({ data }) => setContacts((data || []).filter((c) => c.phone || c.wa_id))) }, [])
  const run = async () => {
    setBusy(true)
    try { const r = await runCadenceNow(); toast(`Cadência: ${r.cadence.advanced} avançou, ${r.cadence.archived} perdido cadência, ${r.cadence.reactivated} voltou ao Dia 1 · ${r.outbox.sent} msg enviada(s)`) }
    catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const setDefault = async (n) => { await supabase.from('wa_numbers').update({ is_default: false }).neq('id', n.id); await supabase.from('wa_numbers').update({ is_default: true }).eq('id', n.id); reload() }
  const toggle = async (n) => { await supabase.from('wa_numbers').update({ active: !n.active }).eq('id', n.id); reload() }
  const remove = async (n) => { const { error } = await supabase.from('wa_numbers').delete().eq('id', n.id); if (error) toast(error.message, 'err'); reload() }
  const pending = waNumbers.some((n) => n.phone_number_id === 'CONFIGURE-NO-PAINEL')
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="between"><h2>Números de WhatsApp</h2><button className="btn primary sm" onClick={() => setEditing({})}>+ Número</button></div>
          <p className="small muted">Cada número cadastrado na API da Meta pode atender leads. O número <b>padrão</b> envia a sequência automática; nas conversas manuais você escolhe o número em cada negócio.</p>
          {pending && <div className="small" style={{ color: 'var(--danger)' }}>Há um número sem o "ID do número de telefone" da Meta. Edite e preencha para conseguir enviar.</div>}
          <div className="list-edit">
            {waNumbers.map((n) => (
              <div key={n.id} className="item" style={{ opacity: n.active ? 1 : .55 }}>
                <div className="grow"><b>{n.label}</b> <span className="muted">{n.phone_display}</span>{n.is_default && <span className="chip" style={{ marginLeft: 6 }}>padrão</span>}
                  <div className="small muted">ID: {n.phone_number_id}</div></div>
                {!n.is_default && n.active && <button className="btn sm" onClick={() => setDefault(n)}>Tornar padrão</button>}
                <button className="btn sm" onClick={() => setEditing(n)}>Editar</button>
                <button className="btn sm" onClick={() => toggle(n)}>{n.active ? 'Desativar' : 'Ativar'}</button>
                <ConfirmButton onConfirm={() => remove(n)}>Excluir</ConfirmButton>
              </div>
            ))}
            {waNumbers.length === 0 && <div className="muted">Nenhum número cadastrado.</div>}
          </div>
        </div>
        <div className="card stack" style={{ gap: 10 }}>
          <div className="between"><h2>Conexão com a Meta</h2>
            <span className="chip dot" style={{ '--chip-color': settings.wa_connected ? 'var(--success)' : 'var(--danger)' }}>{settings.wa_connected ? 'recebendo eventos' : 'aguardando 1º evento'}</span></div>
          <div className="small muted">{settings.wa_last_event_at ? `Último evento recebido: ${new Date(settings.wa_last_event_at).toLocaleString('pt-BR')}` : 'Nenhuma mensagem recebida ainda. A conexão é confirmada quando a primeira mensagem chegar pelo webhook.'}</div>
          <Field label="Webhook do WhatsApp (campo: messages)"><div className="code">{webhookUrl()}</div></Field>
          <MetaCheck />
          <Field label="Webhook do Instagram (campo: messages)"><div className="code">{instagramWebhookUrl()}</div></Field>
        </div>
        <div className="card stack" style={{ gap: 10 }}>
          <h2>Motor da sequência</h2>
          <p className="small muted">Roda automaticamente a cada 5 minutos. Avança os leads que cumpriram o prazo da coluna, move para Perdido cadência quem terminou sem responder, devolve ao Dia 1 quem completou {pipelinesArchiveMonths()} meses em uma coluna de perdido e envia as mensagens pendentes.</p>
          <div><button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Rodando…' : 'Rodar agora'}</button></div>
        </div>
        <div className="card stack" style={{ gap: 10 }}>
          <h2>Teste de envio</h2>
          <Field label="Contato"><select className="select" value={testContact || ''} onChange={(e) => setTestContact(e.target.value || null)}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.wa_id || c.phone})</option>)}</select></Field>
          {testContact && <WhatsAppPanel contactId={testContact} />}
        </div>
      </div>
      <div className="card stack" style={{ gap: 12 }}>
        <h2>Como funciona o fluxo</h2>
        <div className="steps">
          <div><div><b>Lead manda DM no Instagram com o celular</b><div className="small muted">O webhook do Instagram lê a mensagem, extrai o número, busca o nome e o @ do perfil e cria o contato + negócio na coluna <b>Recebidos</b>, sem enviar nada. DM sem número vira uma tarefa "pedir número".</div></div></div>
          <div><div><b>Recebidos → Dia 1 (manual, dosado)</b><div className="small muted">Você arrasta os cards ou usa "Mover em lote", informando a quantidade. A coluna Dia 1 mostra quantos envios saíram nas últimas 24h contra o limite da Meta.</div></div></div>
          <div><div><b>Dia 1 → Dia 5 pelo WhatsApp</b><div className="small muted">A mensagem de cada dia sai pelo número padrão como template aprovado (a Meta exige template para a primeira mensagem, já que quem inicia é a empresa). Sem resposta, o lead avança 1 coluna por dia.</div></div></div>
          <div><div><b>Respondeu → Responsivo</b><div className="small muted">O webhook do WhatsApp detecta a resposta, move o card e a sequência para. A conversa continua manual, aqui dentro, pelo número que você escolher.</div></div></div>
          <div><div><b>Dia 5 sem resposta → Perdido cadência</b><div className="small muted">O card recebe a data de retorno.</div></div></div>
          <div><div><b>4 meses depois → volta ao Dia 1</b><div className="small muted">Automaticamente, com a sequência recomeçando (o card mostra a passagem atual).</div></div></div>
        </div>
        <h2 style={{ marginTop: 6 }}>Como ativar (resumo)</h2>
        <div className="steps">
          <div><div><b>Conta Meta Business + app</b><div className="small muted">App tipo Business em developers.facebook.com com os produtos <b>WhatsApp</b> e <b>Instagram</b> (Messenger API for Instagram).</div></div></div>
          <div><div><b>Instagram profissional ligado a uma Página</b><div className="small muted">Conta Business/Creator, conectada a uma Página do Facebook; permissões instagram_manage_messages e pages_manage_metadata (revisão do app).</div></div></div>
          <div><div><b>Números</b><div className="small muted">Cadastre cada número no WhatsApp Business Platform e informe o "ID do número de telefone" aqui em cima.</div></div></div>
          <div><div><b>Token permanente + secrets</b><div className="small muted">WA_ACCESS_TOKEN, WA_VERIFY_TOKEN, WA_APP_SECRET, IG_ACCESS_TOKEN, CRON_SECRET no Supabase.</div></div></div>
          <div><div><b>Publicar as Edge Functions</b><div className="small muted">whatsapp-webhook, instagram-webhook, whatsapp-send e cadence-run.</div></div></div>
          <div><div><b>Webhooks na Meta</b><div className="small muted">WhatsApp e Instagram, ambos assinando o campo <i>messages</i>, com as URLs acima.</div></div></div>
          <div><div><b>Templates</b><div className="small muted">Um template aprovado por dia (Dia 1 a Dia 5) e o nome informado no ⚙ de cada coluna.</div></div></div>
          <div><div><b>Agendar o motor</b><div className="small muted">supabase/migrations/0003_cron.sql.</div></div></div>
        </div>
        <p className="small muted">Guia completo: <b>docs/GUIA-WHATSAPP.md</b>.{DEMO && ' (Nesta demonstração, nada é enviado de verdade.)'}</p>
      </div>
      {editing && <NumberForm initial={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  )
}

function MetaCheck() {
  const { toast, settings } = useApp()
  const [waba, setWaba] = useState(() => { try { return localStorage.getItem('crm.waba_id') || '' } catch { return '' } })
  useEffect(() => { if (!waba && settings?.wa_waba_id) setWaba(settings.wa_waba_id) }, [settings?.wa_waba_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const check = async () => {
    setBusy(true); setRes(null)
    try { localStorage.setItem('crm.waba_id', waba.trim()) } catch { /* ignore */ }
    if (waba.trim() && waba.trim() !== settings?.wa_waba_id) supabase.from('org_settings').update({ wa_waba_id: waba.trim() }).eq('id', 1).then(() => {})
    try { setRes(await connectWaba(waba)) } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <Field label="ID da conta do WhatsApp (WABA ID)" hint="Verifica o token e liga o CRM a esta conta. Outros sistemas conectados à conta continuam funcionando.">
        <div className="row"><input className="input" value={waba} onChange={(e) => setWaba(e.target.value)} placeholder="ex.: 844738291651828" /><button className="btn primary" onClick={check} disabled={busy || !waba.trim()}>{busy ? 'Verificando…' : 'Verificar e conectar'}</button></div>
      </Field>
      {res && (
        <div className="small stack" style={{ gap: 4 }}>
          {res.missing?.length > 0 && <div style={{ color: 'var(--danger)' }}>Secrets faltando no Supabase: {res.missing.join(', ')}</div>}
          {res.error && <div style={{ color: 'var(--danger)' }}>Erro: {res.error}</div>}
          {res.numbers?.length > 0 && <div><b>Números da conta:</b> {res.numbers.map((n) => `${n.display_phone_number} (${n.verified_name}) — ID ${n.id}`).join(' · ')}</div>}
          {res.subscribe_error && <div style={{ color: 'var(--danger)' }}>Não foi possível ligar o app aos webhooks: {res.subscribe_error}</div>}
          {res.apps && <div><b>Apps recebendo eventos desta conta:</b> {res.apps.join(', ') || '—'}</div>}
          {res.permissions && <div><b>Permissões do token:</b> {res.permissions.join(', ') || '—'}{!res.permissions.includes('whatsapp_business_messaging') && <span style={{ color: 'var(--danger)' }}> — falta whatsapp_business_messaging (necessária para enviar)</span>}</div>}
          {res.assigned_users && <div><b>Acessos na conta:</b> {res.assigned_users.join(' · ') || '—'}</div>}
          {res.phones?.length > 0 && <div><b>Número do CRM na Meta:</b> {res.phones.map((ph) => ph.error ? `erro: ${ph.error}` : `${ph.display_phone_number} · ${ph.status} · ${ph.platform_type} · ${ph.account_mode}`).join(' · ')}</div>}
          {res.templates && <div><b>Modelos de mensagem na Meta:</b> {res.templates.length ? res.templates.map((t) => `${t.name} (${t.language}) — ${t.status}`).join(' · ') : 'nenhum'}</div>}
          {res.waba && !res.waba.error && <div><b>Conta do WhatsApp:</b> {res.waba.name} · dono: {res.waba.owner || '—'}{res.waba.on_behalf_of ? ` · em nome de: ${res.waba.on_behalf_of}` : ''}</div>}
          {res.ok && !res.error && <div style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Token válido e CRM ligado à conta.</div>}
        </div>
      )}
      <RegisterNumber />
    </div>
  )
}

function RegisterNumber() {
  const { waNumbers, toast } = useApp()
  const [num, setNum] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const valid = waNumbers.filter((n) => /^\d+$/.test(n.phone_number_id))
  const current = num || valid[0]?.phone_number_id
  const step = async (action, extra) => {
    setBusy(true)
    try {
      const r = await verifyNumberStep(action, current, extra)
      if (!r.ok) return toast(r.error || 'Não foi possível concluir', 'err')
      if (action === 'request_code') { setCodeSent(true); toast('Código enviado. Confira o SMS ou a ligação no chip deste número.') }
      else { setCodeSent(false); setCode(''); toast('Número verificado. Agora registre com o PIN.') }
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const submit = async () => {
    setBusy(true)
    try {
      const r = await registerNumber(current, pin)
      if (r.ok) toast(`Número registrado${r.phone?.status ? ` · situação: ${r.phone.status}` : ''}`)
      else toast(r.error || 'Não foi possível registrar', 'err')
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false); setPin('') }
  }
  return (
    <details style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Registrar número na API (use se o número parar de enviar/receber após trocar de sistema)</summary>
      <div className="stack small" style={{ gap: 8, marginTop: 8 }}>
        <span className="muted">Informe o PIN de 6 dígitos da verificação em duas etapas do número (Gerenciador do WhatsApp → Números de telefone → Verificação em duas etapas).</span>
        <div className="row wrap">
          <select className="select" style={{ width: 'auto' }} value={num || valid[0]?.phone_number_id || ''} onChange={(e) => setNum(e.target.value)}>
            {valid.map((n) => <option key={n.id} value={n.phone_number_id}>{n.label} {n.phone_display}</option>)}
          </select>
          <input className="input" style={{ width: 120 }} inputMode="numeric" maxLength={6} placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <button className="btn sm" onClick={submit} disabled={busy || pin.length !== 6 || !valid.length}>{busy ? 'Registrando…' : 'Registrar'}</button>
        </div>
        <div className="muted" style={{ marginTop: 4 }}>Se aparecer <b>"re-verification needed"</b> (#133006), verifique o número primeiro. O código chega no chip deste número:</div>
        <div className="row wrap">
          <button className="btn sm" onClick={() => step('request_code', { method: 'SMS' })} disabled={busy || !valid.length}>Enviar código por SMS</button>
          <button className="btn sm ghost" onClick={() => step('request_code', { method: 'VOICE' })} disabled={busy || !valid.length}>Receber por ligação</button>
          {codeSent && <>
            <input className="input" style={{ width: 120 }} inputMode="numeric" maxLength={6} placeholder="Código" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <button className="btn primary sm" onClick={() => step('verify_code', { code })} disabled={busy || code.length < 6}>Confirmar código</button>
          </>}
        </div>
      </div>
    </details>
  )
}

function pipelinesArchiveMonths() { return 4 }

function NumberForm({ initial, onClose, onSaved }) {
  const { toast, waNumbers } = useApp()
  const [f, setF] = useState({ label: '', phone_display: '', phone_number_id: '', owner_id: null, is_default: waNumbers.length === 0, active: true, ...initial })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async (e) => {
    e.preventDefault()
    const row = { label: f.label, phone_display: f.phone_display, phone_number_id: f.phone_number_id.trim(), owner_id: f.owner_id || null, is_default: !!f.is_default, active: !!f.active }
    if (row.is_default) await supabase.from('wa_numbers').update({ is_default: false }).neq('id', initial.id || '00000000-0000-0000-0000-000000000000')
    const { error } = initial.id ? await supabase.from('wa_numbers').update(row).eq('id', initial.id) : await supabase.from('wa_numbers').insert(row)
    if (error) return toast(error.message, 'err')
    toast('Número salvo'); onSaved(); onClose()
  }
  return (
    <Modal title={initial.id ? 'Editar número' : 'Novo número de WhatsApp'} onClose={onClose} footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="nform">Salvar</button></>}>
      <form id="nform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <div className="grid2">
          <Field label="Apelido"><input className="input" value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="Murilo / Comercial 1" required autoFocus /></Field>
          <Field label="Número (exibição)"><input className="input" value={f.phone_display} onChange={(e) => set('phone_display', e.target.value)} placeholder="+55 48 99999-0000" required /></Field>
        </div>
        <Field label="ID do número de telefone (Meta)" hint="No painel da Meta: WhatsApp → Configuração da API → 'ID do número de telefone' (Phone number ID)."><input className="input" value={f.phone_number_id === 'CONFIGURE-NO-PAINEL' ? '' : f.phone_number_id} onChange={(e) => set('phone_number_id', e.target.value)} placeholder="1234567890" required /></Field>
        <Field label="Quem atende por este número (opcional)"><UserSelect value={f.owner_id} onChange={(v) => set('owner_id', v)} allowEmpty /></Field>
        <label className="check"><input type="checkbox" checked={!!f.is_default} onChange={(e) => set('is_default', e.target.checked)} /> Número padrão (envia a sequência automática)</label>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Campos personalizados
// ---------------------------------------------------------------------------------------------
const FIELD_ENTITIES = [['contact', 'Contatos'], ['deal', 'Negócios']]
const FIELD_TYPES = { text: 'Texto', textarea: 'Texto longo', number: 'Número', date: 'Data', select: 'Lista de opções', checkbox: 'Sim/Não', url: 'Link' }

function Fields() {
  const { customFields, reload, toast } = useApp()
  const [editing, setEditing] = useState(null)

  const move = async (list, i, dir) => {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const a = list[i], b = list[j]
    await Promise.all([
      supabase.from('custom_fields').update({ position: j }).eq('id', a.id),
      supabase.from('custom_fields').update({ position: i }).eq('id', b.id),
    ])
    reload()
  }
  const remove = async (f) => {
    const { error } = await supabase.from('custom_fields').delete().eq('id', f.id)
    if (error) return toast(error.message, 'err')
    toast('Campo excluído'); reload()
  }

  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>Campos extras que aparecem nos formulários. Os valores já preenchidos continuam guardados mesmo que o campo seja excluído.</p>
      <div className="grid2" style={{ alignItems: 'start' }}>
        {FIELD_ENTITIES.map(([entity, title]) => {
          const list = customFields.filter((f) => f.entity === entity)
          return (
            <div key={entity} className="card stack" style={{ gap: 12 }}>
              <div className="between"><h2>{title}</h2><button className="btn sm" onClick={() => setEditing({ entity, position: list.length })}>+ Campo</button></div>
              {list.length === 0 ? <div className="small muted">Nenhum campo personalizado.</div> : (
                <div className="list-edit">
                  {list.map((f, i) => (
                    <div key={f.id} className="item">
                      <div className="stack" style={{ gap: 0 }}>
                        <button className="btn ghost sm" style={{ padding: '0 6px' }} onClick={() => move(list, i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                        <button className="btn ghost sm" style={{ padding: '0 6px' }} onClick={() => move(list, i, 1)} disabled={i === list.length - 1} aria-label="Descer">▼</button>
                      </div>
                      <div className="grow">
                        <div style={{ fontWeight: 500 }}>{f.label}{f.required && <span className="muted"> *</span>}</div>
                        <div className="small muted">{FIELD_TYPES[f.type] || f.type}{f.type === 'select' && f.options?.length ? ` · ${f.options.join(', ')}` : ''}</div>
                      </div>
                      <button className="btn sm" onClick={() => setEditing(f)}>Editar</button>
                      <ConfirmButton onConfirm={() => remove(f)}>Excluir</ConfirmButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {editing && <FieldForm initial={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  )
}

function FieldForm({ initial, onClose, onSaved }) {
  const { toast } = useApp()
  const isNew = !initial.id
  const [f, setF] = useState({ label: '', type: 'text', required: false, ...initial, options: (initial.options || []).join(', ') })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async (e) => {
    e.preventDefault()
    const payload = {
      label: f.label.trim(), type: f.type, required: !!f.required,
      options: f.type === 'select' ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : [],
    }
    const q = isNew
      ? supabase.from('custom_fields').insert({ ...payload, entity: f.entity, key: slugify(f.label) || 'campo_' + Date.now(), position: f.position ?? 0 })
      : supabase.from('custom_fields').update(payload).eq('id', f.id)
    const { error } = await q
    if (error) return toast(error.message.includes('duplicate') ? 'Já existe um campo com esse nome.' : error.message, 'err')
    toast('Campo salvo'); onSaved(); onClose()
  }
  return (
    <Modal title={isNew ? 'Novo campo' : 'Editar campo'} onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="fform">Salvar</button></>}>
      <form id="fform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <Field label="Nome do campo"><input className="input" value={f.label} onChange={(e) => set('label', e.target.value)} required autoFocus /></Field>
        <Field label="Tipo">
          <select className="select" value={f.type} onChange={(e) => set('type', e.target.value)}>
            {Object.entries(FIELD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {f.type === 'select' && (
          <Field label="Opções" hint="Separe por vírgula. Ex.: Mentoria, Consulta, Curso">
            <input className="input" value={f.options} onChange={(e) => set('options', e.target.value)} required />
          </Field>
        )}
        <label className="check"><input type="checkbox" checked={!!f.required} onChange={(e) => set('required', e.target.checked)} /> Preenchimento obrigatório</label>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Mensagens prontas (enviadas manualmente no painel de conversa)
// ---------------------------------------------------------------------------------------------
function QuickReplies() {
  const { toast } = useApp()
  const [list, setList] = useState([])
  const [editing, setEditing] = useState(null)
  const load = () => supabase.from('quick_replies').select('*').order('position').then(({ data }) => setList(data || []))
  useEffect(() => { load() }, [])
  const remove = async (q) => { const { error } = await supabase.from('quick_replies').delete().eq('id', q.id); if (error) return toast(error.message, 'err'); load() }
  const move = async (i, dir) => {
    const j = i + dir; if (j < 0 || j >= list.length) return
    await Promise.all([supabase.from('quick_replies').update({ position: j }).eq('id', list[i].id), supabase.from('quick_replies').update({ position: i }).eq('id', list[j].id)])
    load()
  }
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="between wrap">
        <p className="small muted" style={{ margin: 0 }}>Mensagens salvas para enviar com um clique no painel de conversa (botão ⚡). Com opções, o lead recebe botões (até 3) ou uma lista (até 10). Só podem ser enviadas dentro das 24h após a última mensagem do lead. Use {'{{primeiro_nome}}'} para o nome. Uma linha só com --- separa mensagens que saem em sequência.</p>
        <button className="btn primary" onClick={() => setEditing({ position: list.length })}>+ Mensagem pronta</button>
      </div>
      {list.length === 0 ? <div className="card small muted">Nenhuma mensagem pronta.</div> : (
        <div className="list-edit">
          {list.map((q, i) => (
            <div key={q.id} className="item">
              <div className="stack" style={{ gap: 0 }}>
                <button className="btn ghost sm" style={{ padding: '0 6px' }} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                <button className="btn ghost sm" style={{ padding: '0 6px' }} onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Descer">▼</button>
              </div>
              <div className="grow">
                <div style={{ fontWeight: 600 }}><span className="chip" style={{ marginRight: 6 }}>{quickStageLabel(q.stage)}</span>{q.title}{splitParts(q.body).length > 1 && <span className="chip" style={{ marginLeft: 6 }}>{splitParts(q.body).length} mensagens</span>}{q.options?.length > 0 && <span className="chip" style={{ marginLeft: 6 }}>{q.options.length <= 3 ? 'botões' : 'lista'} · {q.options.join(' / ')}</span>}</div>
                <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{q.body}</div>
              </div>
              <button className="btn sm" onClick={() => setEditing(q)}>Editar</button>
              <ConfirmButton onConfirm={() => remove(q)}>Excluir</ConfirmButton>
            </div>
          ))}
        </div>
      )}
      {editing && <QuickReplyForm initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  )
}

function QuickReplyForm({ initial, onClose, onSaved }) {
  const { toast } = useApp()
  const [f, setF] = useState({ stage: initial.stage || '', title: initial.title || '', body: initial.body || '', options: (initial.options || []).join('\n'), auto_before: initial.auto_before || '' })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const opts = f.options.split('\n').map((s) => s.trim()).filter(Boolean)
  const maxLen = opts.length <= 3 ? 20 : 24
  const tooLong = opts.filter((o) => o.length > maxLen)
  const save = async (e) => {
    e.preventDefault()
    if (opts.length > 10) return toast('No máximo 10 opções.', 'err')
    if (tooLong.length) return toast(`Opções com mais de ${maxLen} caracteres: ${tooLong.join(', ')}`, 'err')
    const payload = { stage: f.stage || null, title: f.title.trim(), body: f.body.trim(), options: opts, auto_before: f.auto_before || null }
    const q = initial.id ? supabase.from('quick_replies').update(payload).eq('id', initial.id) : supabase.from('quick_replies').insert({ ...payload, position: initial.position ?? 0 })
    const { error } = await q
    if (error) return toast(error.message, 'err')
    toast('Mensagem pronta salva'); onSaved(); onClose()
  }
  return (
    <Modal title={initial.id ? 'Editar mensagem pronta' : 'Nova mensagem pronta'} onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="qform">Salvar</button></>}>
      <form id="qform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <Field label="Etapa">
          <select className="select" value={f.stage} onChange={(e) => set('stage', e.target.value)}>
            {QUICK_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            <option value="">Outras</option>
          </select>
        </Field>
        <Field label="Título (só para você achar na lista)"><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} required autoFocus /></Field>
        <Field label="Mensagem" hint="Use {{primeiro_nome}} para o primeiro nome do lead. Para mandar várias mensagens seguidas, separe com uma linha só com ---. Escreva entre colchetes e em maiúsculas o que a consultora preenche na hora, como [DATA]."><textarea className="textarea" value={f.body} onChange={(e) => set('body', e.target.value)} required /></Field>
        <Field label="Opções de resposta (opcional, uma por linha)" hint={opts.length === 0 ? 'Sem opções: vai como mensagem de texto normal.' : `${opts.length} opção(ões) → ${opts.length <= 3 ? 'botões' : 'lista'} · até ${maxLen} caracteres cada · máximo 10.`}>
          <textarea className="textarea" style={{ minHeight: 90 }} value={f.options} onChange={(e) => set('options', e.target.value)} placeholder={'Manhã\nTarde\nNoite'} />
        </Field>
        {tooLong.length > 0 && <div className="small" style={{ color: 'var(--danger)' }}>Muito longas: {tooLong.join(', ')}</div>}
        <Field label="Envio automático antes do encontro" hint="Para cards com encontro marcado (dia e hora no Encontro confirmado). Dentro da janela de 24h sai este texto; fora dela, o modelo aprovado configurado, ou uma tarefa para envio manual.">
          <select className="select" value={f.auto_before} onChange={(e) => set('auto_before', e.target.value)}>
            <option value="">Não (só manual)</option>
            <option value="4h">4 horas antes (na véspera às 18h, se o encontro for de manhã)</option>
            <option value="1h">1 hora antes</option>
            <option value="15m">15 minutos antes</option>
          </select>
        </Field>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Usuários e permissões
// ---------------------------------------------------------------------------------------------
function Users() {
  const { users, profile, reload, toast } = useApp()
  const pending = users.filter((u) => !u.active)
  const [inviting, setInviting] = useState(false)

  const update = async (u, patch) => {
    const { error } = await supabase.from('profiles').update(patch).eq('id', u.id)
    if (error) return toast(error.message, 'err')
    toast('Usuário atualizado'); reload()
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card small muted">
        Novas pessoas criam a própria conta na tela de login e ficam <b>aguardando aprovação</b> até um administrador ativá-las aqui.
        <b> Administrador</b> acessa tudo, inclusive estas configurações. <b>Gestor</b> vê e edita todos os registros.
        <b> Vendedor</b> vê {'"'}todos os registros{'"'} ou {'"'}só os próprios{'"'}, conforme a opção em Marca → Visibilidade.
      </div>
      <div className="between wrap">
        {pending.length > 0 ? <div className="small" style={{ color: 'var(--accent)', fontWeight: 600 }}>{pending.length} aguardando aprovação</div> : <span />}
        <button className="btn primary" onClick={() => setInviting(true)}>+ Convidar pessoa</button>
      </div>
      {inviting && <InviteForm onClose={() => setInviting(false)} onSaved={reload} />}
      <div className="card pad0" style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Desde</th></tr></thead>
          <tbody>
            {users.map((u) => {
              const me = u.id === profile?.id
              return (
                <tr key={u.id} style={{ cursor: 'default' }}>
                  <td><div className="row"><Avatar name={u.full_name || u.email} src={u.avatar_url} sm /><span>{u.full_name || '—'}{me && <span className="muted"> (você)</span>}</span></div></td>
                  <td>{u.email}</td>
                  <td>
                    <select className="select" style={{ width: 150 }} value={u.role} disabled={me} title={me ? 'Você não pode alterar o próprio perfil' : ''} onChange={(e) => update(u, { role: e.target.value })}>
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    {u.active
                      ? <div className="row"><span className="chip dot" style={{ '--chip-color': 'var(--success)' }}>Ativo</span>{!me && <button className="btn ghost sm" onClick={() => window.confirm(`Desativar ${u.full_name || u.email}? A pessoa perde o acesso ao CRM.`) && update(u, { active: false })}>Desativar</button>}</div>
                      : <div className="row"><span className="chip dot" style={{ '--chip-color': 'var(--accent)' }}>Aguardando</span><button className="btn primary sm" onClick={() => update(u, { active: true })}>Aprovar</button></div>}
                  </td>
                  <td className="small muted">{fmtDate(u.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function InviteForm({ onClose, onSaved }) {
  const { toast } = useApp()
  const [f, setF] = useState({ email: '', full_name: '', role: 'seller' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', { body: f })
      if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error || error.message)
      if (!data?.ok) throw new Error(data?.error || 'Não foi possível convidar')
      toast(`Convite enviado para ${data.email}`); onSaved(); onClose()
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal title="Convidar pessoa" onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="iform" disabled={busy}>{busy ? 'Enviando…' : 'Enviar convite'}</button></>}>
      <form id="iform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required autoFocus /></Field>
        <Field label="Nome"><input className="input" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Opcional" /></Field>
        <Field label="Perfil">
          <select className="select" value={f.role} onChange={(e) => set('role', e.target.value)}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <p className="small muted" style={{ margin: 0 }}>A pessoa recebe um e-mail com um link para criar a própria senha. O acesso já fica liberado, sem precisar de aprovação.</p>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Automações ("quando X, então Y")
// ---------------------------------------------------------------------------------------------
const TRIGGERS = {
  deal_created: 'Negócio criado',
  deal_stage_changed: 'Negócio mudou de etapa',
  deal_won: 'Negócio ganho',
  deal_lost: 'Negócio perdido',
  contact_created: 'Contato criado',
}
const ACTIONS = { create_activity: 'Criar atividade', add_tag: 'Adicionar tag ao contato', set_deal_field: 'Alterar campo do negócio' }

function Automations() {
  const { pipelines, stages, users, reload: reloadMeta, toast } = useApp()
  const [list, setList] = useState([])
  const [editing, setEditing] = useState(null)
  const load = () => supabase.from('automations').select('*').order('created_at').then(({ data }) => setList(data || []))
  useEffect(() => { load() }, [])

  const describe = (a) => {
    const t = a.trigger_config || {}, c = a.action_config || {}
    const pipe = t.pipeline_id && pipelines.find((p) => p.id === t.pipeline_id)?.name
    const stage = t.stage_id && stages.find((s) => s.id === t.stage_id)?.name
    let when = TRIGGERS[a.trigger_type] || a.trigger_type
    if (stage) when += ` para "${stage}"`
    if (pipe) when += ` (funil ${pipe})`
    let then = ACTIONS[a.action_type] || a.action_type
    if (a.action_type === 'create_activity') {
      const who = c.assign === 'creator' ? 'quem fez a ação' : c.assign && c.assign !== 'owner' ? (users.find((u) => u.id === c.assign)?.full_name || 'usuário') : 'o responsável'
      then = `${ACTIVITY_TYPES[c.type]?.label || 'Atividade'} "${c.title || a.name}" em ${c.days_offset ?? 1} dia(s), para ${who}`
    }
    if (a.action_type === 'add_tag') then = `Adicionar a tag "${c.tag}" ao contato`
    if (a.action_type === 'set_deal_field') then = c.field === 'value' ? `Definir valor do negócio = ${c.value}` : c.field === 'expected_close_days' ? `Previsão de fechamento em ${c.value} dia(s)` : `Campo ${c.key} = ${c.value}`
    return { when, then }
  }
  const toggle = async (a) => {
    const { error } = await supabase.from('automations').update({ active: !a.active }).eq('id', a.id)
    if (error) return toast(error.message, 'err')
    load(); reloadMeta()
  }
  const remove = async (a) => {
    const { error } = await supabase.from('automations').delete().eq('id', a.id)
    if (error) return toast(error.message, 'err')
    toast('Automação excluída'); load()
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="between wrap">
        <p className="small muted" style={{ margin: 0 }}>Regras que rodam sozinhas. A sequência de WhatsApp do funil de mentoria não fica aqui: ela é configurada em cada coluna (Funis e etapas → ⚙).</p>
        <button className="btn primary" onClick={() => setEditing({})}>+ Automação</button>
      </div>
      {list.length === 0 ? <div className="card small muted">Nenhuma automação.</div> : list.map((a) => {
        const { when, then } = describe(a)
        return (
          <div key={a.id} className="card between wrap" style={{ opacity: a.active ? 1 : 0.6 }}>
            <div className="grow" style={{ minWidth: 240 }}>
              <div style={{ fontWeight: 600 }}>{a.name}</div>
              <div className="small"><span className="muted">Quando:</span> {when}</div>
              <div className="small"><span className="muted">Então:</span> {then}</div>
            </div>
            <div className="row">
              <label className="check small"><input type="checkbox" checked={a.active} onChange={() => toggle(a)} /> Ativa</label>
              <button className="btn sm" onClick={() => setEditing(a)}>Editar</button>
              <ConfirmButton onConfirm={() => remove(a)}>Excluir</ConfirmButton>
            </div>
          </div>
        )
      })}
      {editing && <AutomationForm initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  )
}

function AutomationForm({ initial, onClose, onSaved }) {
  const { pipelines, stages, users, toast } = useApp()
  const [f, setF] = useState({
    name: initial.name || '', trigger_type: initial.trigger_type || 'deal_created', action_type: initial.action_type || 'create_activity',
    tc: { ...(initial.trigger_config || {}) },
    ac: { type: 'task', title: '', days_offset: 1, assign: 'owner', ...(initial.action_config || {}) },
    active: initial.active ?? true,
  })
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const setTc = (k, v) => setF((x) => ({ ...x, tc: { ...x.tc, [k]: v || undefined } }))
  const setAc = (k, v) => setF((x) => ({ ...x, ac: { ...x.ac, [k]: v } }))
  const isDealTrigger = f.trigger_type !== 'contact_created'
  const stageOptions = stages.filter((s) => !f.tc.pipeline_id || s.pipeline_id === f.tc.pipeline_id)

  const save = async (e) => {
    e.preventDefault()
    const tc = {}
    if (isDealTrigger && f.tc.pipeline_id) tc.pipeline_id = f.tc.pipeline_id
    if (f.trigger_type === 'deal_stage_changed' && f.tc.stage_id) tc.stage_id = f.tc.stage_id
    let ac = {}
    if (f.action_type === 'create_activity') ac = { type: f.ac.type, title: f.ac.title, description: f.ac.description || undefined, days_offset: Number(f.ac.days_offset || 0), assign: f.ac.assign || 'owner' }
    if (f.action_type === 'add_tag') ac = { tag: (f.ac.tag || '').trim() }
    if (f.action_type === 'set_deal_field') ac = { field: f.ac.field || 'value', value: Number(f.ac.value || 0) }
    const payload = { name: f.name.trim(), trigger_type: f.trigger_type, trigger_config: tc, action_type: f.action_type, action_config: ac, active: f.active }
    const q = initial.id ? supabase.from('automations').update(payload).eq('id', initial.id) : supabase.from('automations').insert(payload)
    const { error } = await q
    if (error) return toast(error.message, 'err')
    toast('Automação salva'); onSaved(); onClose()
  }

  return (
    <Modal title={initial.id ? 'Editar automação' : 'Nova automação'} onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="aform">Salvar</button></>}>
      <form id="aform" onSubmit={save} className="stack" style={{ gap: 12 }}>
        <Field label="Nome"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required autoFocus /></Field>
        <h3>Quando</h3>
        <div className="grid2">
          <Field label="Gatilho">
            <select className="select" value={f.trigger_type} onChange={(e) => set('trigger_type', e.target.value)}>
              {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {isDealTrigger && (
            <Field label="Funil">
              <select className="select" value={f.tc.pipeline_id || ''} onChange={(e) => { setTc('pipeline_id', e.target.value); setTc('stage_id', '') }}>
                <option value="">Todos os funis</option>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        {f.trigger_type === 'deal_stage_changed' && (
          <Field label="Etapa de destino">
            <select className="select" value={f.tc.stage_id || ''} onChange={(e) => setTc('stage_id', e.target.value)}>
              <option value="">Qualquer etapa</option>
              {stageOptions.map((s) => <option key={s.id} value={s.id}>{(pipelines.find((p) => p.id === s.pipeline_id)?.name || '') + ' → ' + s.name}</option>)}
            </select>
          </Field>
        )}
        <h3>Então</h3>
        <Field label="Ação">
          <select className="select" value={f.action_type} onChange={(e) => set('action_type', e.target.value)}>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k} disabled={k === 'set_deal_field' && !isDealTrigger}>{v}</option>)}
          </select>
        </Field>
        {f.action_type === 'create_activity' && (
          <>
            <div className="grid2">
              <Field label="Tipo">
                <select className="select" value={f.ac.type} onChange={(e) => setAc('type', e.target.value)}>
                  {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Prazo (dias depois)"><input className="input" type="number" min="0" value={f.ac.days_offset} onChange={(e) => setAc('days_offset', e.target.value)} /></Field>
            </div>
            <Field label="Título" hint="Pode usar {{deal.title}} e {{contact.name}}."><input className="input" value={f.ac.title} onChange={(e) => setAc('title', e.target.value)} required /></Field>
            <Field label="Atribuir a">
              <select className="select" value={f.ac.assign} onChange={(e) => setAc('assign', e.target.value)}>
                <option value="owner">Responsável pelo negócio/contato</option>
                <option value="creator">Quem realizou a ação</option>
                {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </Field>
          </>
        )}
        {f.action_type === 'add_tag' && <Field label="Tag"><input className="input" value={f.ac.tag || ''} onChange={(e) => setAc('tag', e.target.value)} required /></Field>}
        {f.action_type === 'set_deal_field' && (
          <div className="grid2">
            <Field label="Campo">
              <select className="select" value={f.ac.field || 'value'} onChange={(e) => setAc('field', e.target.value)}>
                <option value="value">Valor (R$)</option>
                <option value="expected_close_days">Previsão de fechamento (dias a partir de hoje)</option>
              </select>
            </Field>
            <Field label="Novo valor"><input className="input" type="number" value={f.ac.value ?? ''} onChange={(e) => setAc('value', e.target.value)} required /></Field>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Ativa</label>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ Agenda Google */
function Agenda() {
  const { settings, sellers, reload, toast } = useApp()
  const [title, setTitle] = useState(settings?.slot_title || 'DISPONÍVEL PARA AGENDAMENTO')
  const [novo, setNovo] = useState({ name: '', email: '' })
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const salvarTitulo = async () => {
    const t = title.trim()
    if (!t || t === settings?.slot_title) return
    const { error } = await supabase.from('org_settings').update({ slot_title: t }).eq('id', 1)
    if (error) return toast(error.message, 'err')
    toast('Título salvo'); reload()
  }
  const adicionar = async (e) => {
    e.preventDefault()
    const email = novo.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('E-mail inválido', 'err')
    const { error } = await supabase.from('calendar_sellers').insert({ name: novo.name.trim(), email, position: (sellers?.length || 0) + 1 })
    if (error) return toast(/duplicate/i.test(error.message) ? 'Essa vendedora já está cadastrada' : error.message, 'err')
    setNovo({ name: '', email: '' }); toast('Vendedora adicionada'); reload()
  }
  const alternar = async (s) => {
    const { error } = await supabase.from('calendar_sellers').update({ active: !s.active }).eq('id', s.id)
    if (error) return toast(error.message, 'err')
    reload()
  }
  const remover = async (s) => {
    const { error } = await supabase.from('calendar_sellers').delete().eq('id', s.id)
    if (error) return toast(error.message, 'err')
    toast('Vendedora removida'); reload()
  }
  const testar = async () => {
    setBusy(true); setStatus(null)
    try { setStatus(await callCalendar('status')) } catch (e) { setStatus({ error: e.message }) } finally { setBusy(false) }
  }

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 820 }}>
      <div className="card stack" style={{ gap: 10 }}>
        <h2>Horários livres</h2>
        <p className="small muted" style={{ margin: 0 }}>A vendedora cria, na agenda Google dela, eventos com exatamente este título nos horários em que pode atender. No card do lead, o CRM busca os próximos, preenche os dois horários da mensagem e, quando o lead escolhe, renomeia o evento para "Consultoria – Nome do lead" e cria o Google Meet.</p>
        <Field label="Título dos eventos de horário livre (maiúsculas e acentos não importam)">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={salvarTitulo} />
        </Field>
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <h2>Lembretes automáticos</h2>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={settings?.reminders_enabled !== false} onChange={async (e) => {
            const { error } = await supabase.from('org_settings').update({ reminders_enabled: e.target.checked }).eq('id', 1)
            if (error) return toast(error.message, 'err')
            toast(e.target.checked ? 'Lembretes ligados' : 'Lembretes desligados'); reload()
          }} />
          Enviar sozinho os lembretes do encontro (4h antes, 1h antes e o link 15 min antes)
        </label>
        <p className="small muted" style={{ margin: 0 }}>Usam as mensagens prontas da etapa Confirmação marcadas como automáticas (Configurações → Mensagens prontas). Dentro da janela de 24h sai o texto; fora dela, o modelo aprovado na Meta, se configurado. Sem modelo, o CRM cria uma tarefa "Enviar lembrete à mão" para o responsável.</p>
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <h2>Vendedoras</h2>
        {(sellers || []).length === 0 && <div className="small muted">Nenhuma vendedora cadastrada.</div>}
        {(sellers || []).map((s) => (
          <div key={s.id} className="row between wrap" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <div><b>{s.name}</b> <span className="small muted">{s.email}</span>{!s.active && <span className="chip" style={{ marginLeft: 6 }}>inativa</span>}</div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => alternar(s)}>{s.active ? 'Desativar' : 'Ativar'}</button>
              <ConfirmButton className="btn danger sm" onConfirm={() => remover(s)}>Remover</ConfirmButton>
            </div>
          </div>
        ))}
        <form className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }} onSubmit={adicionar}>
          <label className="small stack" style={{ gap: 2 }}>Nome<input className="input" required value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} placeholder="Mariana" /></label>
          <label className="small stack grow" style={{ gap: 2, minWidth: 220 }}>E-mail da agenda (@ascentria.com.br)<input className="input" type="email" required value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="mariana@ascentria.com.br" /></label>
          <button className="btn primary">Adicionar</button>
        </form>
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <h2>Conexão com o Google</h2>
        <p className="small muted" style={{ margin: 0 }}>Testa se o CRM consegue ler a agenda de cada vendedora ativa e conta quantos horários livres ela tem.</p>
        <div><button className="btn" onClick={testar} disabled={busy}>{busy ? 'Testando…' : 'Testar conexão'}</button></div>
        {status?.error && <div className="small" style={{ color: 'var(--danger)' }}>{status.error}</div>}
        {status?.sellers && (
          <div className="stack" style={{ gap: 4 }}>
            <div className="small muted">Conta de serviço: <span className="code" style={{ display: 'inline' }}>{status.service_account}</span></div>
            {status.sellers.length === 0 && <div className="small muted">Cadastre ao menos uma vendedora ativa.</div>}
            {status.sellers.map((s) => (
              <div key={s.email} className="small">{s.ok ? '✅' : '⚠️'} <b>{s.name}</b> — {s.ok ? `${s.free} horário(s) livre(s) encontrados` : s.error}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
