-- Mensagens prontas da etapa "Pós-consultoria" (ex.: pesquisa do Murilo logo depois da reunião).
alter table public.quick_replies drop constraint if exists quick_replies_stage_check;
alter table public.quick_replies add constraint quick_replies_stage_check
  check (stage is null or stage = any (array['agendamento','qualificacao','confirmacao','remarcacao','pos']));
