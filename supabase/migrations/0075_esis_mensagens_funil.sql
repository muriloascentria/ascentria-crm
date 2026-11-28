-- Funil eSIS (27/11/2026): mensagens próprias de agendamento, lembretes e remarcação da demonstração do eSIS
-- (título "eSIS · …"), sem qualificação, pesquisa ou menção à mentoria. Os lembretes automáticos passam a usar
-- só as mensagens do funil do card: eSIS → as "eSIS · …"; demais funis → as de sempre.
insert into public.quick_replies (stage, title, body, options, position, auto_before) values
 ('agendamento', 'eSIS · Dois horários', E'Que bom, {{primeiro_nome}}! 😊\n---\nPara a demonstração do *eSIS*, temos disponibilidade (horário de Brasília):\n\n*[DIA 1], às [HORA 1]* ou\n\n*[DIA 2], às [HORA 2]*\n\nQual fica melhor para você?', '{}', 1, null),
 ('agendamento', 'eSIS · Horário escolhido', E'Perfeito, {{primeiro_nome}}! Sua demonstração do *eSIS* está reservada: *[DATA] às [HORA]* (horário de Brasília).', '{}', 2, null),
 ('agendamento', 'eSIS · Confirmação (SIM)', E'Por aqui vou te enviar os lembretes e o link da nossa videochamada.\n---\nPodemos confirmar a demonstração do *eSIS* no dia *[DATA] às [HORA]* (horário de Brasília)?\n\nDigite *SIM* se estiver confirmado 👇🏻', '{}', 3, null),
 ('confirmacao', 'eSIS · Lembrete 4h antes (ou na véspera, se for de manhã)', E'Olá, {{primeiro_nome}}, tudo bem por aí?\n\n[HOJE OU AMANHÃ] às *[HORA]* temos a nossa videochamada pelo Google Meet, em que você vai entender como atuar com segurança no seu Consultório de Enfermagem com o *eSIS*.\n\nAntes do horário, vou te mandar o link por aqui.\n---\nVocê estará presente e disponível nesse horário?', '{}', 302, '4h'),
 ('confirmacao', 'eSIS · Lembrete 1h antes', E'*ESTÁ QUASE NA HORA!*\nDaqui a 1 hora você vai entender como atuar com segurança no seu Consultório de Enfermagem com o *eSIS*. Alguns minutos antes, vou te mandar o link do Google Meet.\n\nTe vejo já já!', '{}', 303, '1h'),
 ('confirmacao', 'eSIS · Envio do link (15 min antes)', E'Olá, {{primeiro_nome}}!\n---\nSegue o link da nossa videochamada, conforme combinado:\n---\n[LINK]\n---\nÀs *[HORA]*, é só clicar no link acima. 👆🏻\n---\nSe puder, entre pelo *computador* 💻 para ver melhor o sistema na tela. Pelo celular também funciona, de preferência na horizontal.', '{}', 304, '15m'),
 ('remarcacao', 'eSIS · Remarcar? (pergunta)', E'Oi, {{primeiro_nome}}! Aqui é o Diego, do time do Enfermeiro Murilo.\n---\nVi que a nossa demonstração do *eSIS* precisou ser cancelada. Imprevistos acontecem, está tudo bem!\n---\nVocê gostaria de remarcar?', '{"Sim, quero remarcar","Não, agora não"}', 400, null),
 ('remarcacao', 'eSIS · Remarcar: dois horários (se SIM)', E'Que bom, {{primeiro_nome}}! 😊\n---\nPara a demonstração do *eSIS*, temos disponibilidade (horário de Brasília):\n\n*[DIA 1], às [HORA 1]* ou\n\n*[DIA 2], às [HORA 2]*\n\nQual fica melhor para você?', '{}', 401, null),
 ('remarcacao', 'eSIS · Não quer remarcar (encerramento)', E'Tudo bem, {{primeiro_nome}}! Entendemos perfeitamente.\n---\nQuando for um bom momento para você, é só me chamar por aqui que retomamos a demonstração do *eSIS*.\n---\nDesejamos muito sucesso no seu Consultório de Enfermagem! 🙏🏻', '{}', 402, null);

-- lembretes automáticos: cada card usa as mensagens do seu funil
do $$
declare d text;
begin
  d := pg_get_functiondef('public.queue_meeting_reminders'::regproc);
  d := replace(d, 'for q in select * from public.quick_replies where auto_before is not null order by position loop',
    'for q in select * from public.quick_replies where auto_before is not null and ((r.pipeline_id = ''a465af9b-4756-47d0-9de5-8990ebe32f50''::uuid) = (title like ''eSIS · %'')) order by position loop');
  d := replace(d, 'where q2.auto_before is not null and q2.auto_before <> q.auto_before',
    'where q2.auto_before is not null and q2.auto_before <> q.auto_before and ((r.pipeline_id = ''a465af9b-4756-47d0-9de5-8990ebe32f50''::uuid) = (q2.title like ''eSIS · %''))');
  if d not like '%eSIS · %%' then raise exception 'não achei o trecho para ajustar'; end if;
  execute d;
end $$;
