-- Responsivo parado: 24h sem mensagem do lead (e sem envio nosso nas últimas 24h, nem encontro marcado)
-- → o card volta para a sequência no Dia SEGUINTE ao de origem (respondeu no Dia 2 → Dia 3).
-- Origem Dia 5 → Perdido cadência. Sem Dia de origem (escreveu primeiro, importados) → Dia 1.
-- Ao entrar no Dia, o modelo daquele Dia é enviado normalmente.
create or replace function public.return_stale_responsive() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  origem public.stages;
  nxt public.stages;
  n int := 0;
begin
  for r in
    select d.id, d.pipeline_id, d.stage_id
      from public.deals d
      join public.stages s on s.id = d.stage_id and s.role = 'responsive'
     where d.status = 'open'
       and greatest(coalesce(d.last_inbound_at, '-infinity'), coalesce(d.last_outbound_at, '-infinity'), d.stage_entered_at) < now() - interval '24 hours'
       and not (d.meeting_date is not null and (d.meeting_date + coalesce(d.meeting_time, time '23:59')) at time zone 'America/Sao_Paulo' > now())
       and exists (select 1 from public.stages x where x.pipeline_id = d.pipeline_id and x.role = 'day')
  loop
    origem := null; nxt := null;
    select st.* into origem
      from public.deal_stage_history h join public.stages st on st.id = h.from_stage_id
     where h.deal_id = r.id and h.to_stage_id = r.stage_id
     order by h.changed_at desc limit 1;

    if origem.id is not null and origem.role = 'day' and origem.pipeline_id = r.pipeline_id then
      select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'day' and position > origem.position order by position limit 1;
      if nxt.id is null then
        select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'archived' order by position limit 1;
      end if;
    else
      select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'day' order by position limit 1;
    end if;

    if nxt.id is not null then
      update public.deals set stage_id = nxt.id where id = r.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.return_stale_responsive() from public, anon, authenticated;

create or replace function public.run_cadence()
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  r record;
  nxt public.stages;
  target uuid;
  advanced int := 0;
  archived int := 0;
  restarted int := 0;
  returned int := 0;
  rem jsonb;
begin
  for r in
    select d.id as deal_id, d.pipeline_id, s.position, s.advance_after_days
      from public.deals d join public.stages s on s.id = d.stage_id
     where d.status = 'open' and s.role = 'day' and s.advance_after_days is not null
       and d.stage_entered_at < now() - (s.advance_after_days || ' days')::interval
  loop
    select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'day' and position > r.position order by position limit 1;
    if nxt.id is null then
      select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'archived' order by position limit 1;
      if nxt.id is not null then archived := archived + 1; end if;
    else
      advanced := advanced + 1;
    end if;
    if nxt.id is not null then update public.deals set stage_id = nxt.id where id = r.deal_id; end if;
  end loop;

  for r in
    select d.id as deal_id, d.pipeline_id, d.owner_id, d.title, d.contact_id, d.cycle, p.reactivate_to_pipeline_id
      from public.deals d
      join public.stages s on s.id = d.stage_id
      join public.pipelines p on p.id = d.pipeline_id
     where s.role = 'archived' and d.reactivate_at is not null and d.reactivate_at <= current_date
  loop
    nxt := null;
    target := r.reactivate_to_pipeline_id;
    if target is not null and target <> r.pipeline_id then
      select * into nxt from public.stages where pipeline_id = target and role = 'day' order by position limit 1;
    end if;
    if nxt.id is null then
      select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'reactivate' order by position limit 1;
      if nxt.id is null then
        select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'day' order by position limit 1;
      end if;
    end if;
    if nxt.id is not null then
      update public.deals set stage_id = nxt.id, reactivate_at = null, cycle = r.cycle + 1 where id = r.deal_id;
      if nxt.role = 'reactivate' then
        insert into public.activities (type, title, description, due_at, deal_id, contact_id, assigned_to, created_by)
        values ('whatsapp', 'Retomar contato: ' || r.title, 'Lead arquivado sem resposta. Hora de tentar de novo.', now(), r.deal_id, r.contact_id, r.owner_id, r.owner_id);
      end if;
      restarted := restarted + 1;
    end if;
  end loop;

  returned := public.return_stale_responsive();
  rem := public.queue_meeting_reminders();
  return jsonb_build_object('advanced', advanced, 'archived', archived, 'reactivated', restarted, 'back_to_sequence', returned) || coalesce(rem, '{}'::jsonb);
end;
$function$;
