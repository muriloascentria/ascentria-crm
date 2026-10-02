-- Lembretes do encontro x janela de 24h do WhatsApp.
-- Fora da janela só sai modelo aprovado pela Meta; sem ele, o lembrete vira tarefa (caso da Laura, 01/10).
-- Agora: se a janela do lead vai fechar ANTES do último lembrete, o CRM pergunta sozinho
-- "Você confirma presença? Responda SIM" enquanto ainda pode mandar texto. Se o lead responde,
-- a janela reabre por mais 24h e os lembretes saem normalmente.
-- Nunca envia entre 22h e 7h: se a janela fecha de madrugada, a pergunta sai entre 19h e 22h da véspera.

alter table public.deals add column if not exists keepalive_at timestamptz;
alter table public.org_settings add column if not exists keepalive_text text not null
  default 'Oi, {{primeiro_nome}}! Passando para confirmar o nosso encontro [HOJE OU AMANHÃ], às [HORA]. Você confirma sua presença? Responda *SIM* 😊';

create or replace function public.queue_window_keepalive() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r public.deals;
  c public.contacts;
  s public.org_settings;
  fecha timestamptz;
  ultimo timestamptz;
  agora_sp timestamp := now() at time zone 'America/Sao_Paulo';
  h int := extract(hour from (now() at time zone 'America/Sao_Paulo'))::int;
  fecha_h int;
  n int := 0;
begin
  select * into s from public.org_settings where id = 1;
  if not coalesce(s.reminders_enabled, true) then return 0; end if;
  if h >= 22 or (now() at time zone 'America/Sao_Paulo')::time < time '06:30' then return 0; end if;   -- madrugada: não incomoda o lead

  for r in
    select * from public.deals
     where status = 'open' and meeting_date is not null and meeting_time is not null and last_inbound_at is not null
       and (meeting_date + meeting_time) at time zone 'America/Sao_Paulo' > now()
       and (meeting_date + meeting_time) at time zone 'America/Sao_Paulo' < now() + interval '2 days'
       and (keepalive_at is null or keepalive_at < last_inbound_at)   -- uma pergunta por janela
  loop
    fecha := r.last_inbound_at + interval '24 hours';
    continue when now() > fecha - interval '12 minutes';    -- já não dá para mandar texto
    -- último lembrete automático que ainda vai sair
    select max(public.reminder_due(q.auto_before, r.meeting_date, r.meeting_time)) into ultimo
      from public.quick_replies q
     where q.auto_before is not null and not (coalesce(r.reminders, '{}'::jsonb) ? q.auto_before);
    continue when ultimo is null or ultimo <= fecha - interval '10 minutes';   -- todos saem dentro da janela

    fecha_h := extract(hour from (fecha at time zone 'America/Sao_Paulo'))::int;
    -- entre 6h30 e 7h só para janela que fecha antes das 8h (encontro bem cedo)
    continue when h < 7 and fecha_h >= 8;
    continue when not (
      now() >= fecha - interval '60 minutes'
      or ((fecha_h >= 22 or fecha_h < 8) and h >= 19 and fecha - now() < interval '14 hours')
    );

    select * into c from public.contacts where id = r.contact_id;
    continue when c.wa_id is null;
    insert into public.wa_outbox (contact_id, deal_id, kind, body, wa_number_id)
    values (c.id, r.id, 'text', public.fill_meeting_text(s.keepalive_text, r, c), coalesce(r.wa_number_id, public.default_wa_number()));
    update public.deals set keepalive_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.queue_window_keepalive() from public, anon, authenticated;

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
  kept int := 0;
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
  kept := public.queue_window_keepalive();
  rem := public.queue_meeting_reminders();
  return jsonb_build_object('advanced', advanced, 'archived', archived, 'reactivated', restarted, 'back_to_sequence', returned, 'confirm_presence', kept) || coalesce(rem, '{}'::jsonb);
end;
$function$;
