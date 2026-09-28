-- Nova etapa de mensagens prontas: Remarcação (quando o lead cancela ou não comparece ao encontro).
alter table public.quick_replies drop constraint if exists quick_replies_stage_check;
alter table public.quick_replies add constraint quick_replies_stage_check
  check (stage is null or stage in ('agendamento','qualificacao','confirmacao','remarcacao'));

insert into public.quick_replies (stage, title, body, options, position) values
('remarcacao', 'Remarcar? (pergunta)',
 E'Oi, {{primeiro_nome}}! Aqui é a Mari, do time do Enfermeiro Murilo.\n---\nVi que o nosso encontro precisou ser cancelado. Imprevistos acontecem, está tudo bem!\n---\nVocê gostaria de remarcar a sua sessão de Consultoria gratuita sobre Consultório de Enfermagem?',
 array['Sim, quero remarcar', 'Não, agora não'], 400),
('remarcacao', 'Remarcar: dois horários (se SIM)',
 E'Que bom, {{primeiro_nome}}! 😊\n---\nTemos disponibilidade *[DIA 1] às [HORA 1]* ou *[DIA 2] às [HORA 2]* (horário de Brasília). Qual fica melhor para você?',
 array[]::text[], 401),
('remarcacao', 'Não quer remarcar (encerramento)',
 E'Tudo bem, {{primeiro_nome}}! Entendemos perfeitamente.\n---\nVamos te chamar em um momento mais oportuno para retomarmos a sua Consultoria gratuita sobre Consultório de Enfermagem.\n---\nDesejamos muito sucesso na sua jornada na Enfermagem! Até breve. 🙏🏻',
 array[]::text[], 402);
