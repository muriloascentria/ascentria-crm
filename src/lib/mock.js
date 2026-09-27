/**
 * Cliente "Supabase" em memória para o modo demonstração (VITE_DEMO=1).
 * Implementa o subconjunto da API usado pelo app e imita os gatilhos do banco
 * (status por etapa, histórico, automações). Nada é persistido.
 */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16) }))
const now = () => new Date().toISOString()
const daysFromNow = (d, h = 10) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString() }
const dateFromNow = (d) => daysFromNow(d).slice(0, 10)

// ---------------------------------------------------------------- seed
const U_ME = 'u-0000-0000-0000-000000000001'
const U_ANA = 'u-0000-0000-0000-000000000002'
const P1 = 'p-0000-0000-0000-000000000001'
const S = ['novo', 'contato', 'qualif', 'proposta', 'negoc', 'ganho', 'perdido'].reduce((o, k, i) => ({ ...o, [k]: `s-0000-0000-0000-00000000000${i + 1}` }), {})
const C = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].reduce((o, k, i) => ({ ...o, [k]: `ct-000-0000-0000-00000000000${i + 1}` }), {})
const P2 = 'p-0000-0000-0000-000000000002'
const P3 = 'p-0000-0000-0000-000000000003'
const W = ['inbox', 'd1', 'd2', 'd3', 'd4', 'd5', 'resp', 'arch', 'react', 'won', 'lost'].reduce((o, k, i) => ({ ...o, [k]: `w-0000-0000-0000-0000000000${String(i + 1).padStart(2, '0')}` }), {})
const WC = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].reduce((o, k, i) => ({ ...o, [k]: `wc-00-0000-0000-00000000000${i + 1}` }), {})
const E = ['e1', 'e2', 'e3', 'e4'].reduce((o, k, i) => ({ ...o, [k]: `co-000-0000-0000-00000000000${i + 1}` }), {})

const db = {
  profiles: [
    { id: U_ME, email: 'murilo@ascentria.com.br', full_name: 'Murilo', role: 'admin', team: 'Direção', active: true, created_at: daysFromNow(-60) },
    { id: U_ANA, email: 'ana@ascentria.com.br', full_name: 'Ana Paula Ribeiro', role: 'seller', team: 'Comercial', active: true, created_at: daysFromNow(-30) },
    { id: 'u-0000-0000-0000-000000000003', email: 'novo@ascentria.com.br', full_name: 'Carlos Mendes', role: 'seller', team: null, active: false, created_at: daysFromNow(-1) },
  ],
  org_settings: [{
    id: 1, company_name: 'Ascentria', logo_url: null, primary_color: '#2e381a', accent_color: '#ab6f30', currency: 'BRL', seller_visibility: 'all',
    wa_phone_display: '+55 48 99999-0000', wa_connected: true, wa_last_event_at: daysFromNow(0, 8), labels: { contacts: 'Contatos', companies: 'Empresas', deals: 'Negócios', pipeline: 'Funil', activities: 'Atividades', dashboard: 'Painel' }, updated_at: now(),
  }],
  pipelines: [
    { id: P1, name: 'Funil de Vendas', position: 0, is_default: true, archive_months: 4, created_at: now() },
    { id: P2, name: 'Mentoria', position: 1, is_default: false, archive_months: 4, daily_limit: 250, reactivate_to_pipeline_id: P3, created_at: now() },
    { id: P3, name: 'Reativação', position: 2, is_default: false, archive_months: 4, daily_limit: 250, reactivate_to_pipeline_id: null, created_at: now() },
  ],
  stages: [
    { id: S.novo, pipeline_id: P1, name: 'Novo lead', position: 0, color: '#babec6', probability: 10, kind: 'open' },
    { id: S.contato, pipeline_id: P1, name: 'Contato feito', position: 1, color: '#818a66', probability: 25, kind: 'open' },
    { id: S.qualif, pipeline_id: P1, name: 'Qualificado', position: 2, color: '#6f8a5a', probability: 45, kind: 'open' },
    { id: S.proposta, pipeline_id: P1, name: 'Proposta enviada', position: 3, color: '#c9973f', probability: 65, kind: 'open' },
    { id: S.negoc, pipeline_id: P1, name: 'Negociação', position: 4, color: '#ab6f30', probability: 80, kind: 'open' },
    { id: S.ganho, pipeline_id: P1, name: 'Ganho', position: 5, color: '#2e381a', probability: 100, kind: 'won' },
    { id: S.perdido, pipeline_id: P1, name: 'Perdido', position: 6, color: '#a8432f', probability: 0, kind: 'lost' },
    { id: W.inbox, pipeline_id: P2, name: 'Recebidos', position: -1, color: '#babec6', probability: 5, kind: 'open', role: 'inbox' },
    { id: W.d1, pipeline_id: P2, name: 'Dia 1', position: 0, color: '#9aa585', probability: 10, kind: 'open', role: 'day', advance_after_days: 1, auto_send: true, wa_template_name: 'mentoria_dia_1', wa_template_lang: 'pt_BR', message_text: 'Oi, {{primeiro_nome}}! Aqui é a Mari, do time do enfermeiro Murilo Pedroso. Você solicitou no Instagram uma consultoria gratuita para estruturar seu consultório de enfermagem com faturamento de mais de 10 mil reais mensais.\nPosso te passar os horários disponíveis para esta semana?' },
    { id: W.d2, pipeline_id: P2, name: 'Dia 2', position: 1, color: '#818a66', probability: 15, kind: 'open', role: 'day', advance_after_days: 1, auto_send: true, wa_template_name: 'mentoria_dia_2', wa_template_lang: 'pt_BR', message_text: 'Poderia ouvir o áudio que enviei?' },
    { id: W.d3, pipeline_id: P2, name: 'Dia 3', position: 2, color: '#6f7d52', probability: 20, kind: 'open', role: 'day', advance_after_days: 1, auto_send: true, wa_template_name: 'mentoria_dia_3', wa_template_lang: 'pt_BR', message_text: 'Oi, {{primeiro_nome}}! Você ainda tem interesse na consultoria para estruturar seu consultório de enfermagem com a meta de faturar pelo menos R$ 10 mil por mês? Se tiver alguma dúvida antes de agendar, pode me falar por aqui.' },
    { id: W.d4, pipeline_id: P2, name: 'Dia 4', position: 3, color: '#c9973f', probability: 25, kind: 'open', role: 'day', advance_after_days: 1, auto_send: true, wa_template_name: 'mentoria_dia_4', wa_template_lang: 'pt_BR', message_text: 'Oi, {{primeiro_nome}}! Passando para retomar a consultoria gratuita que você pediu pelo Instagram. Posso te enviar os horários disponíveis para agendarmos?' },
    { id: W.d5, pipeline_id: P2, name: 'Dia 5', position: 4, color: '#ab6f30', probability: 30, kind: 'open', role: 'day', advance_after_days: 1, auto_send: true, wa_template_name: 'mentoria_dia_5', wa_template_lang: 'pt_BR', message_text: '{{primeiro_nome}}, esta é minha última mensagem sobre a consultoria gratuita que você pediu pelo Instagram.\nSe ainda quiser agendar, responda SIM que te envio os horários. Se não for o momento, responda NÃO e encerro o contato por aqui.' },
    { id: W.resp, pipeline_id: P2, name: 'Responsivo', position: 5, color: '#5c7a3a', probability: 60, kind: 'open', role: 'responsive' },
    { id: W.arch, pipeline_id: P2, name: 'Arquivado', position: 6, color: '#cfc9b6', probability: 0, kind: 'open', role: 'archived' },
    { id: W.won, pipeline_id: P2, name: 'Fechou mentoria', position: 8, color: '#2e381a', probability: 100, kind: 'won' },
    { id: W.lost, pipeline_id: P2, name: 'Perdido', position: 9, color: '#a8432f', probability: 0, kind: 'lost' },
    ...[
      ['Oi, {{primeiro_nome}}! Aqui é a Mari, do time do enfermeiro Murilo Pedroso. Há alguns meses você demonstrou interesse na consultoria gratuita para estruturar seu consultório de enfermagem. Como estão as coisas por aí? Esse ainda é um objetivo seu?', '#9aa585'],
      ['Poderia ouvir o áudio que enviei?', '#818a66'],
      ['Oi, {{primeiro_nome}}! O enfermeiro Murilo abriu novos horários para a consultoria gratuita. Nela, ele ajuda você a estruturar seu consultório com a meta de faturar pelo menos R$ 10 mil por mês. Quer que eu te envie as opções?', '#6f7d52'],
      ['Oi, {{primeiro_nome}}! Ainda tenho alguns horários livres nesta semana para a consultoria gratuita. Posso reservar um para você?', '#c9973f'],
      ['Oi, {{primeiro_nome}}, esta é minha última mensagem por agora sobre a consultoria gratuita.\nSe quiser agendar, responda SIM que te envio os horários. Se não for o momento, responda NÃO e encerro o contato por aqui.', '#ab6f30'],
    ].map(([msg, color], i) => ({ id: `r-d${i + 1}`, pipeline_id: P3, name: `Dia ${i + 1}`, position: i, color, probability: 10 + i * 5, kind: 'open', role: 'day', advance_after_days: 1, auto_send: true, wa_template_name: i === 1 ? 'mentoria_dia_2' : `reativacao_dia_${i + 1}`, wa_template_lang: 'pt_BR', message_text: msg })),
    { id: 'r-resp', pipeline_id: P3, name: 'Responsivo', position: 5, color: '#5c7a3a', probability: 60, kind: 'open', role: 'responsive' },
    { id: 'r-arch', pipeline_id: P3, name: 'Arquivado', position: 6, color: '#cfc9b6', probability: 0, kind: 'open', role: 'archived' },
    { id: 'r-won', pipeline_id: P3, name: 'Fechou mentoria', position: 7, color: '#2e381a', probability: 100, kind: 'won' },
    { id: 'r-lost', pipeline_id: P3, name: 'Perdido', position: 8, color: '#a8432f', probability: 0, kind: 'lost' },
  ],
  companies: [
    { id: E.e1, name: 'Clínica Vida Plena', domain: 'vidaplena.com.br', phone: '(11) 3333-1000', segment: 'Saúde', city: 'São Paulo', notes: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(-40), updated_at: now() },
    { id: E.e2, name: 'Studio Lumen', domain: 'studiolumen.com', phone: null, segment: 'Estética', city: 'Campinas', notes: 'Indicação da Dra. Marina.', owner_id: U_ANA, custom: {}, created_at: daysFromNow(-25), updated_at: now() },
    { id: E.e3, name: 'Grupo Horizonte', domain: 'grupohorizonte.com.br', phone: '(21) 2222-4000', segment: 'Educação', city: 'Rio de Janeiro', notes: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(-12), updated_at: now() },
    { id: E.e4, name: 'Bem-Estar Integrado', domain: null, phone: null, segment: 'Saúde', city: 'Belo Horizonte', notes: null, owner_id: U_ANA, custom: {}, created_at: daysFromNow(-5), updated_at: now() },
  ],
  contacts: [
    { id: C.c1, name: 'Dra. Marina Costa', email: 'marina@vidaplena.com.br', phone: '11999990001', job_title: 'Diretora clínica', source: 'Indicação', tags: ['quente', 'decisora'], notes: null, company_id: E.e1, owner_id: U_ME, custom: { interesse: 'Mentoria' }, created_at: daysFromNow(-40), updated_at: now() },
    { id: C.c2, name: 'Rafael Nogueira', email: 'rafael@studiolumen.com', phone: '19988880002', job_title: 'Sócio', source: 'Instagram', tags: ['proposta'], notes: null, company_id: E.e2, owner_id: U_ANA, custom: { interesse: 'Consultoria' }, created_at: daysFromNow(-25), updated_at: now() },
    { id: C.c3, name: 'Juliana Freitas', email: 'juliana@horizonte.com.br', phone: '21977770003', job_title: 'Coordenadora', source: 'Evento', tags: [], notes: 'Conhecemos no congresso em agosto.', company_id: E.e3, owner_id: U_ME, custom: {}, created_at: daysFromNow(-12), updated_at: now() },
    { id: C.c4, name: 'Pedro Almeida', email: 'pedro.almeida@gmail.com', phone: '31966660004', job_title: null, source: 'Site', tags: ['curso'], notes: null, company_id: null, owner_id: U_ANA, custom: { interesse: 'Curso' }, created_at: daysFromNow(-8), updated_at: now() },
    { id: C.c5, name: 'Beatriz Santos', email: 'bia@bemestar.com', phone: '31955550005', job_title: 'Fundadora', source: 'WhatsApp', tags: ['quente'], notes: null, company_id: E.e4, owner_id: U_ANA, custom: { interesse: 'Mentoria' }, created_at: daysFromNow(-5), updated_at: now() },
    { id: C.c6, name: 'Lucas Ferreira', email: 'lucas.f@outlook.com', phone: '11944440006', job_title: 'Terapeuta', source: 'Anúncio', tags: [], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(-2), updated_at: now() },
    { id: WC.c1, name: 'Fernanda Lima', email: null, phone: '+5548999110001', wa_id: '5548999110001', wa_name: 'Fê Lima', ig_id: 'ig_1001', ig_username: 'fe.lima', job_title: null, source: 'Instagram', tags: ['instagram'], notes: null, company_id: null, owner_id: U_ME, custom: { interesse: 'Mentoria' }, created_at: daysFromNow(0, 8), updated_at: now() },
    { id: WC.c2, name: 'Thiago Moreira', email: null, phone: '+5548999110002', wa_id: '5548999110002', wa_name: 'Thiago M.', ig_id: 'ig_1002', ig_username: 'thiagomoreira', job_title: null, source: 'WhatsApp', tags: ['whatsapp'], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(-2, 8), updated_at: now() },
    { id: WC.c3, name: 'Renata Souza', email: null, phone: '+5548999110003', wa_id: '5548999110003', wa_name: 'Renata', ig_id: 'ig_1003', ig_username: 'renatasouza.oficial', job_title: null, source: 'WhatsApp', tags: ['whatsapp', 'quente'], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(-3, 8), updated_at: now() },
    { id: WC.c4, name: 'Marcos Pereira', email: null, phone: '+5548999110004', wa_id: '5548999110004', wa_name: 'Marcos', job_title: null, source: 'WhatsApp', tags: ['whatsapp'], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(-125, 8), updated_at: now() },
    { id: WC.c6, name: 'Bruna Carvalho', email: null, phone: '+5548999110006', wa_id: '5548999110006', wa_name: null, ig_id: 'ig_1006', ig_username: 'bruna.carvalho', job_title: null, source: 'Instagram', tags: ['instagram'], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(0, 7), updated_at: now() },
    { id: WC.c7, name: 'Diego Ramos', email: null, phone: '+5548999110007', wa_id: '5548999110007', wa_name: null, ig_id: 'ig_1007', ig_username: 'diegoramos.fit', job_title: null, source: 'Instagram', tags: ['instagram'], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(0, 7.5), updated_at: now() },
    { id: WC.c5, name: 'Aline Castro', email: null, phone: '+5548999110005', wa_id: '5548999110005', wa_name: 'Aline C', job_title: null, source: 'WhatsApp', tags: ['whatsapp'], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: daysFromNow(-4, 8), updated_at: now() },
    { id: C.c7, name: 'Camila Rocha', email: 'camila@vidaplena.com.br', phone: null, job_title: 'Gerente administrativa', source: 'Indicação', tags: [], notes: null, company_id: E.e1, owner_id: U_ME, custom: {}, created_at: daysFromNow(-1), updated_at: now() },
  ],
  deals: [
    { id: 'd1', title: 'Mentoria Executiva — Vida Plena', value: 18000, pipeline_id: P1, stage_id: S.negoc, contact_id: C.c1, company_id: E.e1, owner_id: U_ME, status: 'open', expected_close: dateFromNow(6), closed_at: null, lost_reason: null, position: 0, custom: { produto: 'Mentoria', forma_pagamento: 'Parcelado' }, created_at: daysFromNow(-35), updated_at: now() },
    { id: 'd2', title: 'Consultoria de posicionamento — Lumen', value: 9500, pipeline_id: P1, stage_id: S.proposta, contact_id: C.c2, company_id: E.e2, owner_id: U_ANA, status: 'open', expected_close: dateFromNow(-2), closed_at: null, lost_reason: null, position: 0, custom: { produto: 'Consultoria' }, created_at: daysFromNow(-20), updated_at: now() },
    { id: 'd3', title: 'Programa in-company — Horizonte', value: 32000, pipeline_id: P1, stage_id: S.qualif, contact_id: C.c3, company_id: E.e3, owner_id: U_ME, status: 'open', expected_close: dateFromNow(20), closed_at: null, lost_reason: null, position: 0, custom: {}, created_at: daysFromNow(-10), updated_at: now() },
    { id: 'd4', title: 'Curso Método Essência — Pedro', value: 1997, pipeline_id: P1, stage_id: S.contato, contact_id: C.c4, company_id: null, owner_id: U_ANA, status: 'open', expected_close: dateFromNow(10), closed_at: null, lost_reason: null, position: 0, custom: { produto: 'Curso', forma_pagamento: 'À vista' }, created_at: daysFromNow(-7), updated_at: now() },
    { id: 'd5', title: 'Mentoria — Bem-Estar Integrado', value: 12000, pipeline_id: P1, stage_id: S.novo, contact_id: C.c5, company_id: E.e4, owner_id: U_ANA, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: { produto: 'Mentoria' }, created_at: daysFromNow(-4), updated_at: now() },
    { id: 'd6', title: 'Curso Método Essência — Lucas', value: 1997, pipeline_id: P1, stage_id: S.novo, contact_id: C.c6, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 1, custom: { produto: 'Curso' }, created_at: daysFromNow(-2), updated_at: now() },
    { id: 'd7', title: 'Mentoria individual — Camila', value: 8000, pipeline_id: P1, stage_id: S.ganho, contact_id: C.c7, company_id: E.e1, owner_id: U_ME, status: 'won', expected_close: dateFromNow(-3), closed_at: daysFromNow(-3), lost_reason: null, position: 0, custom: { produto: 'Mentoria' }, created_at: daysFromNow(-30), updated_at: now() },
    { id: 'w6', title: 'Bruna Carvalho — Instagram', value: 0, pipeline_id: P2, stage_id: W.inbox, contact_id: WC.c6, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: {}, wa_number_id: 'n1', cycle: 1, stage_entered_at: daysFromNow(0, 7), last_inbound_at: null, reactivate_at: null, created_at: daysFromNow(0, 7), updated_at: now() },
    { id: 'w7', title: 'Diego Ramos — Instagram', value: 0, pipeline_id: P2, stage_id: W.inbox, contact_id: WC.c7, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: {}, wa_number_id: 'n1', cycle: 1, stage_entered_at: daysFromNow(0, 7.5), last_inbound_at: null, reactivate_at: null, created_at: daysFromNow(0, 7.5), updated_at: now() },
    { id: 'w1', title: 'Fernanda Lima — Instagram', value: 0, pipeline_id: P2, stage_id: W.d1, contact_id: WC.c1, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: {}, wa_number_id: 'n1', cycle: 1, stage_entered_at: daysFromNow(0, 8), last_inbound_at: null, reactivate_at: null, created_at: daysFromNow(0, 8), updated_at: now() },
    { id: 'w2', wa_number_id: 'n1', cycle: 1, title: 'Thiago Moreira — WhatsApp', value: 0, pipeline_id: P2, stage_id: W.d3, contact_id: WC.c2, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: {}, stage_entered_at: daysFromNow(0, 9), last_inbound_at: daysFromNow(-2, 15), reactivate_at: null, created_at: daysFromNow(-2, 15), updated_at: now() },
    { id: 'w3', wa_number_id: 'n2', cycle: 1, title: 'Renata Souza — WhatsApp', value: 6000, pipeline_id: P2, stage_id: W.resp, contact_id: WC.c3, company_id: null, owner_id: U_ME, status: 'open', expected_close: dateFromNow(7), closed_at: null, lost_reason: null, position: 0, custom: { produto: 'Mentoria' }, stage_entered_at: daysFromNow(-2, 14), last_inbound_at: daysFromNow(-2, 14), reactivate_at: null, created_at: daysFromNow(-3, 10), updated_at: now() },
    { id: 'w4', wa_number_id: 'n1', cycle: 1, title: 'Marcos Pereira — WhatsApp', value: 0, pipeline_id: P2, stage_id: W.arch, contact_id: WC.c4, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: {}, stage_entered_at: daysFromNow(-119, 9), last_inbound_at: daysFromNow(-125, 11), reactivate_at: dateFromNow(1), created_at: daysFromNow(-125, 11), updated_at: now() },
    { id: 'w5', wa_number_id: 'n1', cycle: 1, title: 'Aline Castro — WhatsApp', value: 0, pipeline_id: P2, stage_id: W.d5, contact_id: WC.c5, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: {}, stage_entered_at: daysFromNow(0, 9), last_inbound_at: daysFromNow(-4, 20), reactivate_at: null, created_at: daysFromNow(-4, 20), updated_at: now() },
    { id: 'd8', title: 'Workshop de equipe — Lumen', value: 4500, pipeline_id: P1, stage_id: S.perdido, contact_id: C.c2, company_id: E.e2, owner_id: U_ANA, status: 'lost', expected_close: null, closed_at: daysFromNow(-9), lost_reason: 'Sem orçamento neste semestre', position: 0, custom: {}, created_at: daysFromNow(-22), updated_at: now() },
  ],
  deal_stage_history: [
    { id: 90, deal_id: 'w2', from_stage_id: W.d1, to_stage_id: W.d2, changed_by: null, changed_at: daysFromNow(-1, 9) },
    { id: 91, deal_id: 'w2', from_stage_id: W.d2, to_stage_id: W.d3, changed_by: null, changed_at: daysFromNow(0, 9) },
    { id: 92, deal_id: 'w3', from_stage_id: W.d1, to_stage_id: W.d2, changed_by: null, changed_at: daysFromNow(-2, 9) },
    { id: 93, deal_id: 'w3', from_stage_id: W.d2, to_stage_id: W.resp, changed_by: null, changed_at: daysFromNow(-2, 14) },
    { id: 1, deal_id: 'd1', from_stage_id: S.novo, to_stage_id: S.contato, changed_by: U_ME, changed_at: daysFromNow(-33) },
    { id: 2, deal_id: 'd1', from_stage_id: S.contato, to_stage_id: S.qualif, changed_by: U_ME, changed_at: daysFromNow(-28) },
    { id: 3, deal_id: 'd1', from_stage_id: S.qualif, to_stage_id: S.proposta, changed_by: U_ME, changed_at: daysFromNow(-15) },
    { id: 4, deal_id: 'd1', from_stage_id: S.proposta, to_stage_id: S.negoc, changed_by: U_ME, changed_at: daysFromNow(-4) },
  ],
  wa_messages: [
    { id: 'm1', contact_id: WC.c1, deal_id: null, direction: 'in', wa_message_id: 'igmid.1', type: 'text', channel: 'instagram', body: 'Oi! Vi o anúncio da mentoria, queria saber mais. Meu whats é 48 99911-0001', status: 'received', created_at: daysFromNow(0, 8) },
    { id: 'm2', contact_id: WC.c1, deal_id: 'w1', direction: 'out', wa_message_id: 'wamid.2', type: 'template', template_name: 'mentoria_dia_1', body: '[template mentoria_dia_1] Fernanda', status: 'read', wa_number_id: 'n1', created_at: daysFromNow(0, 8.02) },
    { id: 'm3', contact_id: WC.c2, deal_id: 'w2', direction: 'in', wa_message_id: 'wamid.3', type: 'text', body: 'Boa tarde, quanto custa a mentoria?', status: 'received', created_at: daysFromNow(-2, 15) },
    { id: 'm4', contact_id: WC.c2, deal_id: 'w2', direction: 'out', wa_message_id: 'wamid.4', type: 'text', body: 'Oi, Thiago! Aqui é o Murilo, da Ascentria. Vi que você chamou aqui — me conta rapidinho: o que te trouxe até a mentoria?', status: 'delivered', created_at: daysFromNow(-2, 15.02) },
    { id: 'm5', contact_id: WC.c2, deal_id: 'w2', direction: 'out', wa_message_id: 'wamid.5', type: 'template', template_name: 'mentoria_dia_2', body: '[template mentoria_dia_2] Thiago', status: 'delivered', created_at: daysFromNow(-1, 9) },
    { id: 'm6', contact_id: WC.c2, deal_id: 'w2', direction: 'out', wa_message_id: 'wamid.6', type: 'template', template_name: 'mentoria_dia_3', body: '[template mentoria_dia_3] Thiago', status: 'sent', created_at: daysFromNow(0, 9) },
    { id: 'm7', contact_id: WC.c3, deal_id: 'w3', direction: 'in', wa_message_id: 'wamid.7', type: 'text', body: 'Oi, uma amiga me indicou vocês', status: 'received', created_at: daysFromNow(-3, 10) },
    { id: 'm8', contact_id: WC.c3, deal_id: 'w3', direction: 'out', wa_message_id: 'wamid.8', type: 'text', body: 'Oi, Renata! Aqui é o Murilo, da Ascentria. Vi que você chamou aqui — me conta rapidinho: o que te trouxe até a mentoria?', status: 'read', created_at: daysFromNow(-3, 10.02) },
    { id: 'm9', contact_id: WC.c3, deal_id: 'w3', direction: 'out', wa_message_id: 'wamid.9', type: 'template', template_name: 'mentoria_dia_2', body: '[template mentoria_dia_2] Renata', status: 'read', created_at: daysFromNow(-2, 9) },
    { id: 'm10', contact_id: WC.c3, deal_id: 'w3', direction: 'in', wa_message_id: 'wamid.10', type: 'text', body: 'Pode mandar o áudio sim! Quero entender melhor', status: 'received', created_at: daysFromNow(-2, 14) },
    { id: 'm11', contact_id: WC.c4, deal_id: 'w4', direction: 'in', wa_message_id: 'wamid.11', type: 'text', body: 'Olá', status: 'received', created_at: daysFromNow(-125, 11) },
    { id: 'm13', contact_id: WC.c6, deal_id: null, direction: 'in', channel: 'instagram', wa_message_id: 'igmid.13', type: 'text', body: 'Oi, vi o post sobre a mentoria! Meu whats: (48) 99911-0006', status: 'received', created_at: daysFromNow(0, 7) },
    { id: 'm14', contact_id: WC.c7, deal_id: null, direction: 'in', channel: 'instagram', wa_message_id: 'igmid.14', type: 'text', body: 'quero saber valores. 48 99911-0007', status: 'received', created_at: daysFromNow(0, 7.5) },
    { id: 'm12', contact_id: WC.c5, deal_id: 'w5', direction: 'in', wa_message_id: 'wamid.12', type: 'text', body: 'oi, é sobre a mentoria', status: 'received', created_at: daysFromNow(-4, 20) },
  ],
  wa_outbox: [],
  wa_numbers: [
    { id: 'n1', label: 'Murilo', phone_display: '+55 48 99999-0000', phone_number_id: '104857600001', is_default: true, active: true, owner_id: U_ME, created_at: daysFromNow(-30) },
    { id: 'n2', label: 'Comercial', phone_display: '+55 48 98888-0000', phone_number_id: '104857600002', is_default: false, active: true, owner_id: U_ANA, created_at: daysFromNow(-10) },
  ],
  activities: [
    { id: 'a9', type: 'whatsapp', title: 'Enviar mensagem — Dia 5: Aline Castro — WhatsApp', description: 'Última mensagem por aqui: se quiser retomar depois, é só me chamar. Deixo a porta aberta. 🙂', due_at: daysFromNow(0, 9), done: false, done_at: null, deal_id: 'w5', contact_id: WC.c5, company_id: null, assigned_to: U_ME, created_by: U_ME, created_at: daysFromNow(0, 9) },
    { id: 'a1', type: 'call', title: 'Ligar para alinhar condições de pagamento', description: null, due_at: daysFromNow(0, 11), done: false, done_at: null, deal_id: 'd1', contact_id: C.c1, company_id: E.e1, assigned_to: U_ME, created_by: U_ME, created_at: daysFromNow(-4) },
    { id: 'a2', type: 'task', title: 'Enviar proposta revisada', description: 'Incluir opção de 12x.', due_at: daysFromNow(-1, 15), done: false, done_at: null, deal_id: 'd2', contact_id: C.c2, company_id: E.e2, assigned_to: U_ANA, created_by: U_ANA, created_at: daysFromNow(-6) },
    { id: 'a3', type: 'meeting', title: 'Reunião de diagnóstico', description: 'Google Meet, 45 min.', due_at: daysFromNow(2, 14), done: false, done_at: null, deal_id: 'd3', contact_id: C.c3, company_id: E.e3, assigned_to: U_ME, created_by: U_ME, created_at: daysFromNow(-8) },
    { id: 'a4', type: 'whatsapp', title: 'Primeiro contato: Mentoria — Bem-Estar Integrado', description: null, due_at: daysFromNow(0, 9), done: false, done_at: null, deal_id: 'd5', contact_id: C.c5, company_id: E.e4, assigned_to: U_ANA, created_by: U_ANA, created_at: daysFromNow(-4) },
    { id: 'a5', type: 'call', title: 'Primeiro contato: Curso Método Essência — Lucas', description: null, due_at: daysFromNow(-1, 10), done: false, done_at: null, deal_id: 'd6', contact_id: C.c6, company_id: null, assigned_to: U_ME, created_by: U_ME, created_at: daysFromNow(-2) },
    { id: 'a6', type: 'note', title: 'Cliente prefere contato por WhatsApp à tarde', description: null, due_at: daysFromNow(-10), done: true, done_at: daysFromNow(-10), deal_id: null, contact_id: C.c1, company_id: null, assigned_to: U_ME, created_by: U_ME, created_at: daysFromNow(-10) },
    { id: 'a7', type: 'email', title: 'Enviar boas-vindas e contrato', description: null, due_at: daysFromNow(-3, 16), done: true, done_at: daysFromNow(-3), deal_id: 'd7', contact_id: C.c7, company_id: E.e1, assigned_to: U_ME, created_by: U_ME, created_at: daysFromNow(-3) },
    { id: 'a8', type: 'task', title: 'Enviar link do curso', description: null, due_at: daysFromNow(1, 10), done: false, done_at: null, deal_id: 'd4', contact_id: C.c4, company_id: null, assigned_to: U_ANA, created_by: U_ANA, created_at: daysFromNow(-1) },
  ],
  custom_fields: [
    { id: 'f1', entity: 'contact', key: 'origem_detalhe', label: 'Detalhe da origem', type: 'text', options: [], required: false, position: 0 },
    { id: 'f2', entity: 'contact', key: 'interesse', label: 'Interesse principal', type: 'select', options: ['Mentoria', 'Consultoria', 'Curso', 'Outro'], required: false, position: 1 },
    { id: 'f3', entity: 'deal', key: 'produto', label: 'Produto/Serviço', type: 'select', options: ['Mentoria', 'Consultoria', 'Curso'], required: false, position: 0 },
    { id: 'f4', entity: 'deal', key: 'forma_pagamento', label: 'Forma de pagamento', type: 'select', options: ['À vista', 'Parcelado', 'Recorrente'], required: false, position: 1 },
  ],
  automations: [
    { id: 'au1', name: 'Follow-up de novo negócio', trigger_type: 'deal_created', trigger_config: { pipeline_id: P1 }, action_type: 'create_activity', action_config: { type: 'call', title: 'Primeiro contato: {{deal.title}}', days_offset: 1, assign: 'owner' }, active: true, created_at: daysFromNow(-50) },
    { id: 'au2', name: 'Lembrete após proposta', trigger_type: 'deal_stage_changed', trigger_config: { stage_id: S.proposta }, action_type: 'create_activity', action_config: { type: 'task', title: 'Acompanhar {{deal.title}}', days_offset: 2, assign: 'owner' }, active: true, created_at: daysFromNow(-50) },
    { id: 'au3', name: 'Marcar contato como cliente', trigger_type: 'deal_won', trigger_config: {}, action_type: 'add_tag', action_config: { tag: 'cliente' }, active: true, created_at: daysFromNow(-50) },
  ],
  quick_replies: [
    { id: 'qe1', stage: "agendamento", title: "Primeiro contato: dois horários", body: "Olá, {{primeiro_nome}}!\n---\nAqui é a Mari, do time do Enfermeiro Murilo. Tudo bem?\n---\nEle me pediu para agendar um horário com você, para te entregar uma sessão de Consultoria gratuita sobre Consultório de Enfermagem.\n---\nTemos disponibilidade *[DIA 1] às [HORA 1]* ou *[DIA 2] às [HORA 2]* (horário de Brasília). Qual fica melhor para você?", options: [], position: 100 },
    { id: 'qe2', stage: "agendamento", title: "Horário escolhido", body: "Perfeito, {{primeiro_nome}}! Horário reservado: *[DATA] às [HORA]* (horário de Brasília).", options: [], position: 101 },
    { id: 'qe3', stage: "qualificacao", title: "Abertura + Pergunta 1 (quem participa)", body: "{{primeiro_nome}}, para entender se conseguimos realmente te ajudar a estruturar seu consultório de Enfermagem, preciso te fazer 4 perguntas rápidas:\n---\n*1) A sessão de Consultoria gratuita é praticamente uma aula sobre Consultório de Enfermagem, onde vamos entregar o nosso melhor para você. Diante disso, existe mais alguém que você acha que deveria estar junto conosco na sessão?*", options: ["Sim, esposa(o)", "Sim, sócio(a)", "Sim, pessoa da família", "Não"], position: 200 },
    { id: 'qe4', stage: "qualificacao", title: "Pergunta 2 (importância de 1 a 10)", body: "*2) De 1 a 10, qual é a importância de estruturar um consultório de Enfermagem que fature pelo menos R$ 10 mil por mês?*", options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], position: 201 },
    { id: 'qe5', stage: "qualificacao", title: "Pergunta 3 (quando pretende começar)", body: "*3) Quando você pretende começar a estruturar seu consultório de Enfermagem?*", options: ["O quanto antes", "Entre 3 e 6 meses", "Daqui a 12 meses"], position: 202 },
    { id: 'qe6', stage: "qualificacao", title: "Pergunta 4 (renda na Enfermagem)", body: "*4) Quanto você ganha por mês com seu trabalho na Enfermagem?* (O piso salarial hoje é R$ 4.750,00.)", options: ["Mais que o piso", "Ganho o piso", "Menos que o piso", "Sem renda na Enfermagem"], position: 203 },
    { id: 'qe7', stage: "qualificacao", title: "Fechamento da qualificação", body: "Já registramos na nossa agenda o tempo que vamos passar com você. Nossa agenda é bem disputada, e por isso estamos te passando esta confirmação.\n\nNo nosso tempo juntos, vamos mostrar como você pode estruturar seu Consultório de Enfermagem e faturar pelo menos R$ 10.000,00 por mês com seus atendimentos.\n\nEntão, confirmando: *dia [DATA] às [HORA]* (horário de Brasília).", options: [], position: 204 },
    { id: 'qe8', stage: "agendamento", title: "Importância e confirmação (SIM)", body: "Enf. {{primeiro_nome}}, por aqui vou enviar os lembretes e o link da nossa videochamada.\n---\nAtender você e outros enfermeiros em videochamada é o nosso trabalho, e fazemos isso com muita dedicação. É algo que levamos a sério.\n---\nPor outro lado, tempo é dinheiro, e tanto o seu tempo quanto o nosso são muito valiosos.\n---\nOutros enfermeiros também pediram essa consultoria. Reservar este horário para você significa não poder oferecê-lo a outra pessoa. Se você não comparecer, nem você nem esses profissionais serão atendidos.\n---\nPor isso, podemos confirmar a nossa videochamada no dia *[DATA] às [HORA]* (horário de Brasília)?\nDigite *SIM* se estiver confirmado 👇🏻", options: [], position: 102 },
    { id: 'qe9', stage: "confirmacao", title: "Depois do SIM", body: "Confirmado, {{primeiro_nome}}! 🙌🏻\n---\nAntes do nosso encontro eu te mando os lembretes por aqui, e o link da videochamada chega nesta conversa 15 minutos antes do horário.\n---\nUma dica: esteja num lugar tranquilo, com fone de ouvido, papel e caneta. Vale muito a pena anotar.", options: [], position: 301 },
    { id: 'qe10', stage: "confirmacao", title: "Lembrete 4h antes (ou na véspera, se for de manhã)", body: "Olá, {{primeiro_nome}}, tudo bem por aí?\nEstamos te deixando aqui o nosso Instagram https://www.instagram.com/enfermeiromurilo/ e YouTube: https://www.youtube.com/@enfermeiromurilo caso você queira dar uma olhada antes da nossa videochamada [HOJE OU AMANHÃ] às *[HORA]* no Google Meet.\n\n[HOJE OU AMANHÃ], antes do horário da nossa videochamada às *[HORA]*, vamos te mandar o link do Google Meet.\n---\nVocê estará presente e disponível para focar nesse tempo que estaremos juntos?", options: [], position: 302 },
    { id: 'qe11', stage: "confirmacao", title: "Lembrete 1h antes", body: "*ESTÁ QUASE NA HORA!*\nTudo certo para, daqui a 1 hora, você ter acesso a como estruturar seu Consultório de Enfermagem? Alguns minutos antes já vamos te mandar o link do Google Meet.\n\nLembre que é importante que você esteja presente e focado, porque vamos analisar o seu momento atual na Enfermagem e te mostrar o caminho para estruturar o seu Consultório de Enfermagem.\n\nTe vemos já já!", options: [], position: 303 },
    { id: 'qe12', stage: "confirmacao", title: "Envio do link (15 min antes)", body: "Olá, {{primeiro_nome}}\n---\nSegue link conforme combinado.\n---\n[LINK]", options: [], position: 304 },
  ],
  automation_runs: [
    { id: 1, automation_id: 'au1', entity: 'deal', entity_id: 'd6', ok: true, message: 'create_activity', ran_at: daysFromNow(-2) },
    { id: 2, automation_id: 'au1', entity: 'deal', entity_id: 'd5', ok: true, message: 'create_activity', ran_at: daysFromNow(-4) },
  ],
}

// ---------------------------------------------------------------- auth
let session = { user: { id: U_ME, email: 'murilo@ascentria.com.br' } }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn('CHANGE', session))

const auth = {
  getSession: async () => ({ data: { session } }),
  onAuthStateChange: (fn) => { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } } },
  signInWithPassword: async () => { session = { user: { id: U_ME, email: 'murilo@ascentria.com.br' } }; emit(); return { data: { session }, error: null } },
  signUp: async ({ email, options }) => {
    const id = uid()
    db.profiles.push({ id, email, full_name: options?.data?.full_name || email.split('@')[0], role: 'seller', team: null, active: false, created_at: now() })
    session = { user: { id, email } }; emit(); return { data: { session }, error: null }
  },
  signOut: async () => { session = null; emit(); return { error: null } },
  resetPasswordForEmail: async () => ({ error: null }),
  updateUser: async () => ({ error: null }),
}

// ---------------------------------------------------------------- gatilhos
const relTable = { contact: 'contacts', company: 'companies', deal: 'deals' }
const renderTpl = (t = '', d, c) => t.replace('{{deal.title}}', d?.title ?? '').replace('{{deal.value}}', String(d?.value ?? '')).replace('{{contact.name}}', c?.name ?? '')

function runAutomation(a, d, c) {
  const cfg = a.action_config || {}
  if (a.action_type === 'create_activity') {
    const assign = cfg.assign === 'creator' ? session.user.id : /^[0-9a-f-]{36}$/.test(cfg.assign || '') ? cfg.assign : d?.owner_id || c?.owner_id || session.user.id
    db.activities.push({ id: uid(), type: cfg.type || 'task', title: renderTpl(cfg.title || a.name, d, c), description: renderTpl(cfg.description || '', d, c) || null, due_at: daysFromNow(cfg.days_offset ?? 1), done: false, done_at: null, deal_id: d?.id ?? null, contact_id: d?.contact_id ?? c?.id ?? null, company_id: d?.company_id ?? c?.company_id ?? null, assigned_to: assign, created_by: session.user.id, created_at: now() })
  } else if (a.action_type === 'add_tag') {
    const ct = db.contacts.find((x) => x.id === (c?.id || d?.contact_id))
    if (ct && cfg.tag) ct.tags = [...ct.tags.filter((t) => t !== cfg.tag), cfg.tag]
  } else if (a.action_type === 'set_deal_field' && d) {
    if (cfg.field === 'value') d.value = Number(cfg.value)
    if (cfg.field === 'expected_close_days') d.expected_close = dateFromNow(Number(cfg.value))
    if (cfg.field === 'custom') d.custom = { ...d.custom, [cfg.key]: cfg.value }
  }
  db.automation_runs.unshift({ id: db.automation_runs.length + 1, automation_id: a.id, entity: d ? 'deal' : 'contact', entity_id: d?.id || c?.id, ok: true, message: a.action_type, ran_at: now() })
}

function beforeWrite(table, row, old) {
  if (table === 'deals') {
    if (!old || row.stage_id !== old.stage_id) {
      const st = db.stages.find((s) => s.id === row.stage_id)
      if (st) { row.pipeline_id = st.pipeline_id; if (st.kind !== 'open') { row.status = st.kind; row.closed_at = row.closed_at || now() } else { row.status = 'open'; row.closed_at = null; row.lost_reason = null } }
      row.stage_entered_at = now()
      if (st?.role === 'archived') { const m = db.pipelines.find((p) => p.id === st.pipeline_id)?.archive_months ?? 4; const x = new Date(); x.setMonth(x.getMonth() + m); row.reactivate_at = x.toISOString().slice(0, 10) }
    }
  }
  if (table === 'activities') { if (row.done && !row.done_at) row.done_at = now(); if (!row.done) row.done_at = null; if (!row.assigned_to) row.assigned_to = session.user.id }
  if (['companies', 'contacts', 'deals'].includes(table) && !old) { row.created_by = row.created_by || session.user.id; if (!row.owner_id) row.owner_id = session.user.id }
}
const inWindow = (d) => d.last_inbound_at && Date.now() - new Date(d.last_inbound_at).getTime() < 86400000
const renderMsg = (t = '', c) => t.replace(/{{primeiro_nome}}/g, (c?.name || '').split(' ')[0]).replace(/{{nome}}/g, c?.name || '')
function queueStageMessage(d, st) {
  const c = db.contacts.find((x) => x.id === d.contact_id)
  if (!c?.wa_id || !(st.message_text || st.wa_template_name)) return
  const msg = renderMsg(st.message_text, c)
  if (st.auto_send && (st.wa_template_name || inWindow(d))) {
    if (inWindow(d) && msg) db.wa_outbox.push({ id: db.wa_outbox.length + 1, contact_id: c.id, deal_id: d.id, wa_number_id: d.wa_number_id || 'n1', kind: 'text', body: msg, status: 'pending', attempts: 0, created_at: now() })
    else db.wa_outbox.push({ id: db.wa_outbox.length + 1, contact_id: c.id, deal_id: d.id, wa_number_id: d.wa_number_id || 'n1', kind: 'template', template_name: st.wa_template_name, template_params: /\{\{(primeiro_nome|nome)\}\}/.test(st.message_text || '') ? [(c.name || '').split(' ')[0] || c.ig_username || 'tudo bem'] : [], status: 'pending', attempts: 0, created_at: now() })
  } else {
    db.activities.push({ id: uid(), type: 'whatsapp', title: `Enviar mensagem — ${st.name}: ${d.title}`, description: msg || null, due_at: now(), done: false, done_at: null, deal_id: d.id, contact_id: c.id, company_id: null, assigned_to: d.owner_id, created_by: d.owner_id, created_at: now() })
  }
}
function afterWrite(table, row, old) {
  const auto = db.automations.filter((a) => a.active && (!a.trigger_config?.pipeline_id || a.trigger_config.pipeline_id === row.pipeline_id))
  if (table === 'deals') {
    const c = db.contacts.find((x) => x.id === row.contact_id)
    if (!old || row.stage_id !== old.stage_id) { const st = db.stages.find((s) => s.id === row.stage_id); if (st?.role === 'day') queueStageMessage(row, st) }
    if (!old) auto.filter((a) => a.trigger_type === 'deal_created').forEach((a) => runAutomation(a, row, c))
    else if (row.stage_id !== old.stage_id) {
      db.deal_stage_history.push({ id: db.deal_stage_history.length + 1, deal_id: row.id, from_stage_id: old.stage_id, to_stage_id: row.stage_id, changed_by: session.user.id, changed_at: now() })
      auto.forEach((a) => {
        if (a.trigger_type === 'deal_stage_changed' && (!a.trigger_config?.stage_id || a.trigger_config.stage_id === row.stage_id)) runAutomation(a, row, c)
        if (a.trigger_type === 'deal_won' && row.status === 'won') runAutomation(a, row, c)
        if (a.trigger_type === 'deal_lost' && row.status === 'lost') runAutomation(a, row, c)
      })
    }
  }
  if (table === 'contacts' && !old) auto.filter((a) => a.trigger_type === 'contact_created').forEach((a) => runAutomation(a, null, row))
}
function beforeDelete(table, row) {
  if (table === 'stages' && db.deals.some((d) => d.stage_id === row.id)) throw new Error('Existem negócios nesta etapa.')
  if (table === 'pipelines' && db.deals.some((d) => d.pipeline_id === row.id)) throw new Error('Existem negócios neste funil.')
}
function cascade(table, row) {
  if (table === 'pipelines') db.stages = db.stages.filter((s) => s.pipeline_id !== row.id)
  if (table === 'deals') { db.activities = db.activities.filter((a) => a.deal_id !== row.id); db.deal_stage_history = db.deal_stage_history.filter((h) => h.deal_id !== row.id) }
  if (table === 'contacts') { db.activities = db.activities.filter((a) => a.contact_id !== row.id); db.deals.forEach((d) => { if (d.contact_id === row.id) d.contact_id = null }) }
  if (table === 'companies') { db.activities = db.activities.filter((a) => a.company_id !== row.id); db.deals.forEach((d) => { if (d.company_id === row.id) d.company_id = null }); db.contacts.forEach((c) => { if (c.company_id === row.id) c.company_id = null }) }
}

// ---------------------------------------------------------------- query builder
function parseSelect(sel = '*') {
  // "*, contact:contacts(name), contacts(count)" → [{alias, table, cols}]
  const rels = []
  const re = /(?:(\w+):)?(\w+)\(([^)]*)\)/g
  let m
  while ((m = re.exec(sel))) rels.push({ alias: m[1] || m[2], table: m[2], cols: m[3].split(',').map((s) => s.trim()) })
  return rels
}
const fk = { contacts: 'contact_id', companies: 'company_id', deals: 'deal_id', profiles: 'owner_id', stages: 'stage_id', pipelines: 'pipeline_id' }
function embed(table, row, rels) {
  const out = { ...row }
  rels.forEach((r) => {
    if (r.cols[0] === 'count') { out[r.alias] = [{ count: db[r.table].filter((x) => x[fk[table]] === row.id).length }]; return }
    const target = db[r.table]?.find((x) => x.id === row[fk[r.table]])
    out[r.alias] = target ? (r.cols[0] === '*' ? { ...target } : Object.fromEntries(r.cols.map((c) => [c, target[c]]))) : null
  })
  return out
}

class Query {
  constructor(table) { this.table = table; this.filters = []; this.orders = []; this.op = 'select'; this.rels = []; this.wantSingle = false; this.lim = null; this.returning = false }
  select(sel) { if (this.op === 'select') { this.rels = parseSelect(sel) } else this.returning = true; return this }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this }
  update(patch) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this }
  neq(k, v) { this.filters.push((r) => r[k] !== v); return this }
  order(k, o = {}) { this.orders.push({ k, asc: o.ascending !== false, nullsFirst: o.nullsFirst }); return this }
  limit(n) { this.lim = n; return this }
  single() { this.wantSingle = true; return this }
  _rows() { return db[this.table].filter((r) => this.filters.every((f) => f(r))) }
  _run() {
    const t = this.table
    if (!db[t]) return { data: null, error: { message: `Tabela desconhecida: ${t}` } }
    try {
      if (this.op === 'select') {
        let rows = this._rows().map((r) => embed(t, r, this.rels))
        for (const o of [...this.orders].reverse()) rows.sort((a, b) => {
          const x = a[o.k], y = b[o.k]
          if (x == null && y == null) return 0
          if (x == null) return o.nullsFirst === false ? 1 : -1
          if (y == null) return o.nullsFirst === false ? -1 : 1
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1)
        })
        if (this.lim) rows = rows.slice(0, this.lim)
        if (this.wantSingle) return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'Registro não encontrado' } }
        return { data: rows, error: null }
      }
      if (this.op === 'insert') {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => {
          const row = { id: uid(), created_at: now(), updated_at: now(), ...defaultsFor(t), ...p }
          beforeWrite(t, row, null); db[t].push(row); afterWrite(t, row, null); return row
        })
        return { data: this.wantSingle ? rows[0] : rows, error: null }
      }
      if (this.op === 'update') {
        const rows = this._rows()
        if (t === 'profiles') { const me = session.user.id; if (rows.some((r) => r.id === me) && ('role' in this.payload || 'active' in this.payload) && db.profiles.find((p) => p.id === me).role !== 'admin') return { data: null, error: { message: 'Sem permissão' } } }
        rows.forEach((r) => { const old = { ...r }; Object.assign(r, this.payload, { updated_at: now() }); beforeWrite(t, r, old); afterWrite(t, r, old) })
        return { data: this.wantSingle ? rows[0] : rows, error: null }
      }
      if (this.op === 'delete') {
        const rows = this._rows()
        rows.forEach((r) => beforeDelete(t, r))
        rows.forEach((r) => cascade(t, r))
        db[t] = db[t].filter((r) => !rows.includes(r))
        return { data: rows, error: null }
      }
    } catch (e) { return { data: null, error: { message: e.message } } }
  }
  then(res, rej) { return Promise.resolve(this._run()).then(res, rej) }
}
function defaultsFor(t) {
  return {
    contacts: { tags: [], custom: {} }, companies: { custom: {} }, deals: { value: 0, status: 'open', custom: {}, position: 0 },
    activities: { type: 'task', done: false }, stages: { kind: 'open', probability: 50, color: '#64748b', position: 0 },
    custom_fields: { options: [], required: false, position: 0 }, quick_replies: { stage: null, options: [], position: 0 }, automations: { active: true, trigger_config: {}, action_config: {} },
    pipelines: { is_default: false, position: 0 },
  }[t] || {}
}

// ---------------------------------------------------------------- motor da cadência (espelho de run_cadence)
function runCadence() {
  let advanced = 0, archived = 0, reactivated = 0
  db.deals.filter((d) => d.status === 'open').forEach((d) => {
    const s = db.stages.find((x) => x.id === d.stage_id)
    if (s?.role === 'day' && s.advance_after_days && new Date(d.stage_entered_at) < new Date(Date.now() - s.advance_after_days * 86400000)) {
      let nxt = db.stages.filter((x) => x.pipeline_id === d.pipeline_id && x.role === 'day' && x.position > s.position).sort((a, b) => a.position - b.position)[0]
      if (!nxt) { nxt = db.stages.find((x) => x.pipeline_id === d.pipeline_id && x.role === 'archived'); if (nxt) archived++ } else advanced++
      if (nxt) { const old = { ...d }; d.stage_id = nxt.id; beforeWrite('deals', d, old); afterWrite('deals', d, old) }
    }
  })
  db.deals.forEach((d) => {
    const s = db.stages.find((x) => x.id === d.stage_id)
    if (s?.role === 'archived' && d.reactivate_at && d.reactivate_at <= new Date().toISOString().slice(0, 10)) {
      const target = db.pipelines.find((p) => p.id === d.pipeline_id)?.reactivate_to_pipeline_id
      const firstDay = (pid) => db.stages.filter((x) => x.pipeline_id === pid && x.role === 'day').sort((a, b) => a.position - b.position)[0]
      const nxt = (target && target !== d.pipeline_id && firstDay(target))
        || db.stages.find((x) => x.pipeline_id === d.pipeline_id && x.role === 'reactivate')
        || firstDay(d.pipeline_id)
      if (nxt) {
        const old = { ...d }; d.stage_id = nxt.id; d.reactivate_at = null; d.cycle = (d.cycle || 1) + 1; beforeWrite('deals', d, old); afterWrite('deals', d, old)
        if (nxt.role === 'reactivate') db.activities.push({ id: uid(), type: 'whatsapp', title: `Retomar contato: ${d.title}`, description: 'Lead arquivado sem resposta. Hora de tentar de novo.', due_at: now(), done: false, done_at: null, deal_id: d.id, contact_id: d.contact_id, company_id: null, assigned_to: d.owner_id, created_by: d.owner_id, created_at: now() })
        reactivated++
      }
    }
  })
  let sent = 0
  db.wa_outbox.filter((o) => o.status === 'pending').forEach((o) => {
    o.status = 'sent'; o.sent_at = now(); sent++
    db.wa_messages.push({ id: uid(), contact_id: o.contact_id, deal_id: o.deal_id, direction: 'out', wa_number_id: o.wa_number_id || null, wa_message_id: 'wamid.' + uid(), type: o.kind, template_name: o.template_name || null, body: o.kind === 'template' ? `[template ${o.template_name}] ${(o.template_params || []).join(', ')}` : o.body, status: 'sent', created_at: now() })
  })
  return { advanced, archived, reactivated, sent }
}

const functions = {
  invoke: async (name, { body } = {}) => {
    if (name === 'cadence-run') {
      // demo: simula a passagem de 1 dia antes de rodar o motor
      db.deals.forEach((d) => { const s = db.stages.find((x) => x.id === d.stage_id); if (s?.role) { d.stage_entered_at = new Date(new Date(d.stage_entered_at).getTime() - 86400000).toISOString(); if (d.last_inbound_at) d.last_inbound_at = new Date(new Date(d.last_inbound_at).getTime() - 86400000).toISOString(); if (d.reactivate_at) { const x = new Date(d.reactivate_at); x.setDate(x.getDate() - 1); d.reactivate_at = x.toISOString().slice(0, 10) } } })
      const r = runCadence()
      return { data: { ok: true, cadence: r, outbox: { sent: r.sent, failed: 0 } }, error: null }
    }
    if (name === 'whatsapp-send') {
      const c = db.contacts.find((x) => x.id === body.contact_id)
      if (!c) return { data: { ok: false, error: 'Contato não encontrado' }, error: null }
      const text = body.kind === 'template' ? `[template ${body.template_name}] ${(body.template_params || []).join(', ')}` : body.kind === 'interactive' ? `${body.body}\n${(body.options || []).map((o) => `▸ ${o}`).join('\n')}` : body.body
      db.wa_messages.push({ id: uid(), contact_id: c.id, deal_id: body.deal_id || null, direction: 'out', wa_number_id: body.wa_number_id || 'n1', wa_message_id: 'wamid.' + uid(), type: body.kind, template_name: body.template_name || null, body: text, status: 'sent', sent_by: session.user.id, created_at: now() })
      // demo: o lead responde em 2s e o negócio vai para "Responsivo"
      setTimeout(() => {
        db.wa_messages.push({ id: uid(), contact_id: c.id, deal_id: body.deal_id || null, direction: 'in', wa_message_id: 'wamid.' + uid(), type: 'text', body: 'Oi! Pode me contar mais? 😊', status: 'received', created_at: now() })
        const d = db.deals.find((x) => x.contact_id === c.id && x.status === 'open' && db.stages.find((s) => s.id === x.stage_id)?.role)
        if (d) { const st = db.stages.find((s) => s.id === d.stage_id); const resp = db.stages.find((s) => s.pipeline_id === d.pipeline_id && s.role === 'responsive'); const old = { ...d }; d.last_inbound_at = now(); if (['inbox', 'day', 'archived', 'reactivate'].includes(st.role) && resp) { d.stage_id = resp.id; beforeWrite('deals', d, old); afterWrite('deals', d, old) } }
      }, 2000)
      return { data: { ok: true, id: 'wamid.demo' }, error: null }
    }
    if (name === 'invite-user') {
      if (db.profiles.some((p) => p.email === body.email)) return { data: { ok: false, error: 'Já existe uma conta com este e-mail.' }, error: null }
      db.profiles.push({ id: uid(), email: body.email, full_name: body.full_name || body.email.split('@')[0], role: body.role || 'seller', active: true, created_at: now() })
      return { data: { ok: true, email: body.email }, error: null }
    }
    if (name === 'wa-connect' && ['request_code', 'verify_code'].includes(body?.action)) return { data: { ok: true, error: null }, error: null }
    if (name === 'wa-connect' && body?.action === 'register') return { data: { ok: true, error: null, phone: { status: 'CONNECTED' } }, error: null }
    if (name === 'wa-connect') {
      return { data: { ok: true, missing: [], numbers: [{ id: '100000000000001', display_phone_number: '+55 48 99911-2233', verified_name: 'Ascentria' }], subscribe_error: null, apps: ['Ascentria CRM'] }, error: null }
    }
    if (name === 'demo-instagram') {
      const names = [['Larissa Mendes', 'lari.mendes'], ['Gustavo Pinto', 'gpinto'], ['Paula Nunes', 'paulanunes'], ['Rafael Duarte', 'rafa.duarte']]
      const [nm, user] = names[db.contacts.length % names.length]
      const phone = '5548' + String(900000000 + Math.floor(Math.random() * 99999999))
      const c = { id: uid(), name: nm, email: null, phone: '+' + phone, wa_id: phone, ig_id: 'ig_' + uid(), ig_username: user, job_title: null, source: 'Instagram', tags: ['instagram'], notes: null, company_id: null, owner_id: U_ME, custom: {}, created_at: now(), updated_at: now() }
      db.contacts.push(c)
      db.wa_messages.push({ id: uid(), contact_id: c.id, deal_id: null, direction: 'in', channel: 'instagram', wa_message_id: 'igmid.' + uid(), type: 'text', body: `Oi! Quero saber da mentoria. Meu número: ${phone.slice(2, 4)} ${phone.slice(4, 9)}-${phone.slice(9)}`, status: 'received', created_at: now() })
      const first = db.stages.find((s) => s.pipeline_id === P2 && s.role === 'inbox') || db.stages.filter((s) => s.pipeline_id === P2 && s.role === 'day').sort((a, b) => a.position - b.position)[0]
      const d = { id: uid(), title: `${nm} — Instagram`, value: 0, pipeline_id: P2, stage_id: first.id, contact_id: c.id, company_id: null, owner_id: U_ME, status: 'open', expected_close: null, closed_at: null, lost_reason: null, position: 0, custom: {}, wa_number_id: 'n1', cycle: 1, last_inbound_at: null, reactivate_at: null, created_at: now(), updated_at: now() }
      beforeWrite('deals', d, null); db.deals.push(d); afterWrite('deals', d, null)
      return { data: { ok: true, name: nm, deal_id: d.id }, error: null }
    }
    return { data: null, error: { message: 'Função desconhecida: ' + name } }
  },
}

export const mockClient = { auth, from: (t) => new Query(t), functions, rpc: async (name, args = {}) => {
  if (name === 'run_cadence') return { data: runCadence(), error: null }
  if (name === 'sent_last_24h') return { data: db.wa_messages.filter((m) => m.direction === 'out' && m.type === 'template' && Date.now() - new Date(m.created_at).getTime() < 86400000).length, error: null }
  if (name === 'move_inbox_to_day1') {
    const inbox = db.stages.find((s) => s.pipeline_id === args.p_pipeline && s.role === 'inbox')
    const day1 = db.stages.filter((s) => s.pipeline_id === args.p_pipeline && s.role === 'day').sort((a, b) => a.position - b.position)[0]
    if (!inbox || !day1) return { data: 0, error: null }
    const sel = db.deals.filter((d) => d.stage_id === inbox.id && d.status === 'open').sort((a, b) => a.created_at < b.created_at ? -1 : 1).slice(0, args.p_count)
    sel.forEach((d) => { const old = { ...d }; d.stage_id = day1.id; beforeWrite('deals', d, old); afterWrite('deals', d, old) })
    runCadence() // demo: envia os templates do Dia 1 na hora
    return { data: sel.length, error: null }
  }
  return { data: null, error: { message: 'rpc desconhecida' } }
} }
