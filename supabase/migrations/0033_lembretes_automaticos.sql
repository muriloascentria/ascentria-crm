-- Lembretes automáticos do encontro (Reunião agendada), a partir das mensagens prontas da etapa Confirmação:
--   4h  → 4 horas antes; se o encontro for de manhã (antes das 12h), na véspera às 18h
--   1h  → 1 hora antes
--   15m → 15 minutos antes (envio do link)
-- Dentro da janela de 24h do WhatsApp sai o texto da mensagem pronta (com dia, hora e link preenchidos).
-- Fora da janela, sai o modelo aprovado configurado em org_settings.reminder_templates; sem modelo,
-- o CRM cria uma tarefa para alguém enviar à mão (nunca deixa o lembrete sumir em silêncio).

alter table public.quick_replies add column if not exists auto_before text;
alter table public.quick_replies drop constraint if exists quick_replies_auto_before_check;
alter table public.quick_replies add constraint quick_replies_auto_before_check check (auto_before is null or auto_before in ('4h','1h','15m'));
update public.quick_replies set auto_before = '4h'  where stage = 'confirmacao' and title ilike 'Lembrete 4h%';
update public.quick_replies set auto_before = '1h'  where stage = 'confirmacao' and title ilike 'Lembrete 1h%';
update public.quick_replies set auto_before = '15m' where stage = 'confirmacao' and title ilike 'Envio do link%';

alter table public.deals add column if not exists reminders jsonb not null default '{}'::jsonb;
alter table public.deals add column if not exists reminders_armed_at timestamptz;
alter table public.org_settings add column if not exists reminders_enabled boolean not null default true;
alter table public.org_settings add column if not exists reminder_templates jsonb not null default '{}'::jsonb;

-- Marcou/remarcou o encontro: zera os lembretes e guarda quando foi marcado.
create or replace function public.deals_reset_reminders() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.meeting_date is distinct from old.meeting_date or new.meeting_time is distinct from old.meeting_time then
    new.reminders := '{}'::jsonb;
    new.reminders_armed_at := case when new.meeting_date is not null and new.meeting_time is not null then now() end;
  end if;
  return new;
end $$;
drop trigger if exists deals_reset_reminders on public.deals;
create trigger deals_reset_reminders before insert or update of meeting_date, meeting_time on public.deals
  for each row execute function public.deals_reset_reminders();
update public.deals set reminders_armed_at = updated_at where meeting_date is not null and meeting_time is not null and reminders_armed_at is null;

-- Preenche {{primeiro_nome}}, [DATA]/[DIA], [HORA], [HOJE OU AMANHÃ] e [LINK] (mesma regra das mensagens prontas no CRM).
create or replace function public.fill_meeting_text(tpl text, d public.deals, c public.contacts) returns text
language plpgsql stable set search_path = public as $$
declare
  t text := coalesce(tpl, '');
  nome text := public.lead_first_name(c);
  dias text[] := array['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
  dl text; tl text; quando text; delta int;
begin
  t := replace(replace(t, '{{primeiro_nome}}', nome), '{{nome}}', nome);
  if d.meeting_date is not null then
    dl := to_char(d.meeting_date, 'DD/MM') || ' (' || dias[extract(dow from d.meeting_date)::int + 1] || ')';
    delta := d.meeting_date - (now() at time zone 'America/Sao_Paulo')::date;
    quando := case delta when 0 then 'hoje' when 1 then 'amanhã' else 'no dia ' || to_char(d.meeting_date, 'DD/MM') end;
    t := regexp_replace(t, '\[(DATA|DIA)\]', dl, 'g');
    t := regexp_replace(t, '(^|\n)\[HOJE OU AMANHÃ\]', '\1' || upper(left(quando, 1)) || substr(quando, 2), 'g');
    t := replace(t, '[HOJE OU AMANHÃ]', quando);
  end if;
  if d.meeting_time is not null then
    tl := extract(hour from d.meeting_time)::int || 'h' || to_char(d.meeting_time, 'MI');
    t := replace(t, '[HORA]', tl);
  end if;
  if nullif(trim(coalesce(d.meeting_link, '')), '') is not null then t := replace(t, '[LINK]', trim(d.meeting_link)); end if;
  return t;
end $$;

-- Ajuste: se o CRM ficou fora do ar e dois lembretes venceram juntos, manda só o mais recente.
create or replace function public.reminder_due(k text, d date, t time) returns timestamptz
language sql immutable set search_path = public as $$
  select case k
    when '4h' then case when t < time '12:00' then ((d - 1) + time '18:00') at time zone 'America/Sao_Paulo'
                        else ((d + t) at time zone 'America/Sao_Paulo') - interval '4 hours' end
    when '1h' then ((d + t) at time zone 'America/Sao_Paulo') - interval '1 hour'
    else ((d + t) at time zone 'America/Sao_Paulo') - interval '15 minutes' end
$$;

create or replace function public.queue_meeting_reminders() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.deals;
  q public.quick_replies;
  c public.contacts;
  s public.org_settings;
  meet timestamptz; due timestamptz;
  body text; parts text[]; i int; tpl jsonb; params jsonb; motivo text;
  sent int := 0; tasks int := 0; skipped int := 0;
begin
  select * into s from public.org_settings where id = 1;
  if not coalesce(s.reminders_enabled, true) then return jsonb_build_object('disabled', true); end if;

  for r in
    select * from public.deals
     where status = 'open' and meeting_date is not null and meeting_time is not null
       and (meeting_date + meeting_time) at time zone 'America/Sao_Paulo' > now()
       and (meeting_date + meeting_time) at time zone 'America/Sao_Paulo' < now() + interval '2 days'
  loop
    meet := (r.meeting_date + r.meeting_time) at time zone 'America/Sao_Paulo';
    for q in select * from public.quick_replies where auto_before is not null order by position loop
      continue when r.reminders ? q.auto_before;
      due := case q.auto_before
               when '4h' then case when r.meeting_time < time '12:00'
                                   then ((r.meeting_date - 1) + time '18:00') at time zone 'America/Sao_Paulo'
                                   else meet - interval '4 hours' end
               when '1h' then meet - interval '1 hour'
               else meet - interval '15 minutes' end;
      continue when now() < due;

      -- encontro marcado depois do horário deste lembrete: não manda lembrete "atrasado"
      if coalesce(r.reminders_armed_at, r.updated_at) > due + interval '10 minutes'
         or exists (select 1 from public.quick_replies q2 where q2.auto_before is not null and q2.auto_before <> q.auto_before
                     and public.reminder_due(q2.auto_before, r.meeting_date, r.meeting_time) between due + interval '1 second' and now()) then
        r.reminders := r.reminders || jsonb_build_object(q.auto_before, 'pulado');
        update public.deals set reminders = r.reminders where id = r.id;
        skipped := skipped + 1;
        continue;
      end if;

      select * into c from public.contacts where id = r.contact_id;
      body := public.fill_meeting_text(q.body, r, c);
      motivo := null;

      if c.wa_id is null then
        motivo := 'contato sem WhatsApp';
      elsif body ~ '\[[A-ZÀ-Ú0-9 ]+\]' then
        motivo := 'faltou preencher ' || (select string_agg(distinct m[1], ', ') from regexp_matches(body, '(\[[A-ZÀ-Ú0-9 ]+\])', 'g') m);
      elsif r.last_inbound_at is not null and r.last_inbound_at > now() - interval '23 hours 50 minutes' then
        -- dentro da janela: o texto da mensagem pronta, em partes (separadas por ---), na ordem
        parts := array(select trim(x) from unnest(regexp_split_to_array(body, '\n[ \t]*---[ \t]*(\n|$)')) x where trim(x) <> '');
        for i in 1 .. coalesce(array_length(parts, 1), 0) loop
          insert into public.wa_outbox (contact_id, deal_id, kind, body, wa_number_id, created_at)
          values (c.id, r.id, 'text', parts[i], coalesce(r.wa_number_id, public.default_wa_number()), now() + (i * interval '1 millisecond'));
        end loop;
      elsif s.reminder_templates ? q.auto_before then
        -- fora da janela: modelo aprovado na Meta
        tpl := s.reminder_templates -> q.auto_before;
        params := coalesce((
          select jsonb_agg(case p
                   when 'primeiro_nome' then public.lead_first_name(c)
                   when 'quando' then public.fill_meeting_text('[HOJE OU AMANHÃ]', r, c)
                   when 'data' then public.fill_meeting_text('[DATA]', r, c)
                   when 'hora' then public.fill_meeting_text('[HORA]', r, c)
                   when 'link' then coalesce(nullif(trim(r.meeting_link), ''), '')
                   else p end order by o)
            from jsonb_array_elements_text(coalesce(tpl -> 'params', '[]'::jsonb)) with ordinality e(p, o)), '[]'::jsonb);
        if params @> '[""]'::jsonb then
          motivo := 'fora da janela de 24h e sem o link do Meet';
        else
          insert into public.wa_outbox (contact_id, deal_id, kind, template_name, template_lang, template_params, wa_number_id)
          values (c.id, r.id, 'template', tpl ->> 'name', coalesce(tpl ->> 'lang', 'pt_BR'), params, coalesce(r.wa_number_id, public.default_wa_number()));
        end if;
      else
        motivo := 'fora da janela de 24h do WhatsApp (sem modelo aprovado para este lembrete)';
      end if;

      if motivo is null then
        insert into public.quick_reply_sends (contact_id, quick_reply_id, deal_id) values (c.id, q.id, r.id);
        r.reminders := r.reminders || jsonb_build_object(q.auto_before, now());
        sent := sent + 1;
      else
        insert into public.activities (type, title, description, due_at, deal_id, contact_id, assigned_to, created_by)
        values ('whatsapp', 'Enviar lembrete à mão — ' || q.title || ': ' || r.title,
                'O lembrete automático não saiu: ' || motivo || '.' || E'\n\n' || body, now(), r.id, r.contact_id, r.owner_id, r.owner_id);
        r.reminders := r.reminders || jsonb_build_object(q.auto_before, 'tarefa');
        tasks := tasks + 1;
      end if;
      update public.deals set reminders = r.reminders where id = r.id;
    end loop;
  end loop;
  return jsonb_build_object('reminders_sent', sent, 'reminder_tasks', tasks, 'reminders_skipped', skipped);
end $$;
revoke execute on function public.queue_meeting_reminders() from public, anon, authenticated;
revoke execute on function public.fill_meeting_text(text, public.deals, public.contacts) from public, anon, authenticated;

-- O motor (cadence-run) passa a enfileirar os lembretes junto com a cadência.
create or replace function public.run_cadence()
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  r record;
  nxt public.stages;
  target uuid;
  advanced int := 0;
  archived int := 0;
  restarted int := 0;
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

  rem := public.queue_meeting_reminders();
  return jsonb_build_object('advanced', advanced, 'archived', archived, 'reactivated', restarted) || coalesce(rem, '{}'::jsonb);
end;
$function$;

-- O agendador passa a rodar a cada 5 minutos (os lembretes de 15 min precisam dessa precisão).
select cron.alter_job((select jobid from cron.job where jobname = 'crm-cadence-hourly'), schedule := '*/5 * * * *');
