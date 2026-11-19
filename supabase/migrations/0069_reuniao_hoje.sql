-- Coluna "Reunião hoje" (primeira do funil da Mentoria), pedido do Murilo em 19/11/2026.
-- Os cards de "Reunião agendada" com reunião marcada para hoje passam sozinhos para "Reunião hoje".
-- Se a reunião for remarcada para outro dia, o card volta para "Reunião agendada".
-- Depois da reunião, quem atendeu move o card para o resultado (Fechou, Não compareceu...); no dia seguinte,
-- o que ainda estiver em "Reunião hoje" vai sozinho para "Aguardando encaminhamento" (pedido do Murilo, 19/11/2026).
do $$
declare
  p uuid := '00000000-0000-0000-0000-000000000002';
begin
  if not exists (select 1 from public.stages where pipeline_id = p and name = 'Reunião hoje') then
    update public.stages set position = position + 1 where pipeline_id = p;
    insert into public.stages (pipeline_id, name, position, color, probability, kind, role, auto_send, wa_template_lang)
    values (p, 'Reunião hoje', 0, '#1f5c3a', 75, 'open', null, false, 'pt_BR');
  end if;
end $$;

create or replace function public.mover_reuniao_hoje() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  st_hoje uuid; st_ag uuid; st_aguard uuid; foram int := 0; voltaram int := 0; aguardando int := 0;
begin
  select id into st_hoje from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and name = 'Reunião hoje';
  select id into st_ag   from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and name = 'Reunião agendada';
  if st_hoje is null or st_ag is null then return jsonb_build_object('erro', 'coluna não encontrada'); end if;

  update public.deals set stage_id = st_hoje
   where stage_id = st_ag and status = 'open' and meeting_date = hoje;
  get diagnostics foram = row_count;

  update public.deals set stage_id = st_ag
   where stage_id = st_hoje and status = 'open' and meeting_date > hoje;
  get diagnostics voltaram = row_count;

  -- No dia seguinte à reunião, quem ficou em "Reunião hoje" (sem resultado) vai para "Aguardando encaminhamento".
  select id into st_aguard from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and name = 'Aguardando encaminhamento';
  if st_aguard is not null then
    update public.deals set stage_id = st_aguard
     where stage_id = st_hoje and status = 'open' and (meeting_date is null or meeting_date < hoje);
    get diagnostics aguardando = row_count;
  end if;

  return jsonb_build_object('foram_para_hoje', foram, 'voltaram_para_agendada', voltaram, 'foram_para_aguardando', aguardando);
end $$;

select cron.schedule('crm-reuniao-hoje', '*/5 * * * *', $$ select public.mover_reuniao_hoje(); $$);
select public.mover_reuniao_hoje();
