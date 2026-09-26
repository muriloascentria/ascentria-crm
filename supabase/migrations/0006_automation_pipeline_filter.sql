-- =====================================================================
-- Automações podem ser limitadas a um funil (trigger_config.pipeline_id)
-- =====================================================================
create or replace function public.deals_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public.automations;
  c public.contacts;
begin
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, old.stage_id, new.stage_id, auth.uid());
  end if;

  select * into c from public.contacts where id = new.contact_id;

  for a in select * from public.automations where active
             and (trigger_config->>'pipeline_id' is null or (trigger_config->>'pipeline_id')::uuid = new.pipeline_id) loop
    if tg_op = 'INSERT' and a.trigger_type = 'deal_created' then
      perform public.run_automation(a, new, c);
    elsif tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
      if a.trigger_type = 'deal_stage_changed'
         and (a.trigger_config->>'stage_id' is null or (a.trigger_config->>'stage_id')::uuid = new.stage_id) then
        perform public.run_automation(a, new, c);
      elsif a.trigger_type = 'deal_won' and new.status = 'won' then
        perform public.run_automation(a, new, c);
      elsif a.trigger_type = 'deal_lost' and new.status = 'lost' then
        perform public.run_automation(a, new, c);
      end if;
    end if;
  end loop;
  return null;
end;
$$;

-- o follow-up padrão vale só para o Funil de Vendas (não para os leads do Instagram)
update public.automations
   set trigger_config = trigger_config || '{"pipeline_id":"00000000-0000-0000-0000-000000000001"}'::jsonb
 where name = 'Follow-up de novo negócio';
