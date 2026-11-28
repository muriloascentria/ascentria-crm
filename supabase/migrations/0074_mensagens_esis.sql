-- Funil eSIS (27/11/2026): grupo de mensagens prontas "eSIS" (venda do sistema pelo WhatsApp/direct, sem sessão 1:1)
alter table public.quick_replies drop constraint if exists quick_replies_stage_check;
alter table public.quick_replies add constraint quick_replies_stage_check
  check (stage is null or stage = any (array['agendamento','qualificacao','confirmacao','remarcacao','pos','cobranca','esis']));
