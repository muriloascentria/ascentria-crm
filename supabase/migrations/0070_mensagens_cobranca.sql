-- Mensagens prontas de Cobrança para o funil "Inadimplentes" (pedido do Murilo em 24/11/2026).
alter table public.quick_replies drop constraint if exists quick_replies_stage_check;
alter table public.quick_replies add constraint quick_replies_stage_check
  check (stage is null or stage = any (array['agendamento','qualificacao','confirmacao','remarcacao','pos','cobranca']));
