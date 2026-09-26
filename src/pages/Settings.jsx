import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/store'
import { ConfirmButton, Field, Modal } from '../components/ui'
import { ACTIVITY_TYPES, ROLES, slugify } from '../lib/utils'
import { STAGE_ROLES, instagramWebhookUrl, runCadenceNow, webhookUrl } from '../lib/wa'
import { UserSelect } from '../components/ui'
import { DEMO } from '../lib/supabase'
import WhatsAppPanel from '../components/WhatsAppPanel'

const TABS = [['brand', 'Marca'], ['pipelines', 'Funis e etapas'], ['whatsapp', 'WhatsApp'], ['fields', 'Campos personalizados'], ['users', 'Usuários e permissões'], ['automations', 'Automações']]

export default function Settings() {
  const [tab, setTab] = useState('brand')
  return (
    <>
      <div className="page-head"><h1>Configurações</h1></div>
      <div className="tabs">{TABS.map(([k, t]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{t}</button>)}</div>
      {tab === 'brand' && <Brand />}
      {tab === 'pipelines' && <Pipelines />}
      {tab === 'fields' && <Fields />}
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
        {Object.entries(f.labels).map(([k, v]) => <Field key={k} label={k}><input className="input" value={v} onChange={(e) => setLabel(k, e.target.value)} /></Field>)}
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
          <p className="small muted">Etapas do tipo <b>Ganho</b> e <b>Perdido</b> fecham o negócio automaticamente ao receber um card. A probabilidade alimenta a previsão ponderada do painel. O botão <b>⚙</b> define a função da coluna na sequência de WhatsApp (dia, responsivo, arquivado, reativar), a mensagem do dia e o avanço automático.</p>
          {draft.some((s) => s.role === 'archived') && (
            <div className="row small wrap"><span>Leads arquivados voltam ao Dia 1 após</span><input className="input" type="number" min="1" defaultValue={pipe.archive_months ?? 4} onBlur={(e) => Number(e.target.value) !== pipe.archive_months && setArchiveMonths(e.target.value)} style={{ width: 70 }} /><span>meses</span>
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
          <Field label="Avançar para a próxima coluna após (dias sem resposta)" hint="Na última coluna de dia, o lead vai para 'Arquivado'."><input className="input" type="number" min="1" value={s.advance_after_days ?? ''} onChange={(e) => onChange('advance_after_days', e.target.value)} /></Field>
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
      {s.role && s.role !== 'day' && <p className="small muted">{{ inbox: 'Leads do Instagram (e novos leads em geral) entram aqui automaticamente, sem envio. Você move para o Dia 1 arrastando ou pelo botão "Mover em lote", respeitando o limite diário da Meta.', responsive: 'Quando o lead responde (webhook da Meta), o negócio é movido para esta coluna e a sequência para.', archived: 'Leads que terminam a sequência sem responder vêm para cá e recebem a data de retorno. Quando ela chega, o lead volta sozinho ao primeiro dia da sequência.', reactivate: 'Opcional. Se existir uma coluna com esta função, o lead arquivado vem para cá (com a tarefa "Retomar contato") em vez de voltar ao Dia 1.' }[s.role]}</p>}
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
    try { const r = await runCadenceNow(); toast(`Cadência: ${r.cadence.advanced} avançou, ${r.cadence.archived} arquivado, ${r.cadence.reactivated} voltou ao Dia 1 · ${r.outbox.sent} msg enviada(s)`) }
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
          <Field label="Webhook do Instagram (campo: messages)"><div className="code">{instagramWebhookUrl()}</div></Field>
        </div>
        <div className="card stack" style={{ gap: 10 }}>
          <h2>Motor da sequência</h2>
          <p className="small muted">Roda automaticamente a cada hora. Avança os leads que cumpriram o prazo da coluna, arquiva quem terminou sem responder, devolve ao Dia 1 quem completou {pipelinesArchiveMonths()} meses arquivado e envia as mensagens pendentes.</p>
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
          <div><div><b>Dia 5 sem resposta → Arquivado</b><div className="small muted">O card recebe a data de retorno.</div></div></div>
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
