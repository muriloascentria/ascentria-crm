-- =====================================================================
-- Ascentria CRM — Gatilho pelo Instagram, vários números de WhatsApp,
-- reinício da sequência no Dia 1 após o arquivamento
-- =====================================================================

-- ---------------------------------------------------------------------
-- Números de WhatsApp cadastrados na API da Meta
-- (o token fica nos secrets; aqui só o ID do número e a exibição)
-- ---------------------------------------------------------------------
create table public.wa_numbers (
  id               uuid primary key default gen_random_uuid(),
  label            text not null,                 -- ex.: "Murilo", "Comercial 1"
  phone_display    text not null,                 -- ex.: +55 48 99999-0000
  phone_number_id  text not null unique,          -- "ID do número de telefone" no painel da Meta
  is_default       boolean not null default false,
  active           boolean not null default true,
  owner_id         uuid references public.profiles(id) on delete set null, -- quem normalmente atende por este número
  created_at       timestamptz not null default now()
);
alter table public.wa_numbers enable row level security;
create policy "wa_numbers_select" on public.wa_numbers for select to authenticated using (public.is_active_user());
create policy "wa_numbers_admin"  on public.wa_numbers for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- número que atende cada lead
alter table public.deals add column wa_number_id uuid references public.wa_numbers(id) on delete set null;
alter table public.deals add column cycle int not null default 1;   -- quantas vezes o lead já passou pela sequência

-- migra o número antigo (se existia) para a tabela
insert into public.wa_numbers (label, phone_display, phone_number_id, is_default)
select 'Principal', coalesce(wa_phone_display, '+55'), 'CONFIGURE-NO-PAINEL', true
  from public.org_settings where id = 1 and not exists (select 1 from public.wa_numbers);

create or replace function public.default_wa_number()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.wa_numbers where active order by is_default desc, created_at limit 1
$$;

-- ---------------------------------------------------------------------
-- Instagram
-- ---------------------------------------------------------------------
alter table public.contacts
  add column ig_id       text,          -- IGSID (id do usuário na conversa do Instagram)
  add column ig_username text;
create unique index contacts_ig_id_key on public.contacts (ig_id) where ig_id is not null;

alter table public.wa_messages add column channel text not null default 'whatsapp' check (channel in ('whatsapp','instagram'));

-- extrai um celular brasileiro de um texto livre; devolve no formato 55DDDNNNNNNNNN ou null
create or replace function public.extract_br_phone(t text)
returns text language plpgsql immutable as $$
declare
  m text;
  digits text;
begin
  if t is null then return null; end if;
  -- captura sequências como +55 (48) 99999-0000, 48999990000, 48 9 9999 0000, 5548999990000
  for m in select (regexp_matches(t, '((?:\+?\s*55)?\s*\(?\s*\d{2}\s*\)?\s*9?\s*\d{4}\s*[-.\s]?\s*\d{4})', 'g'))[1] loop
    digits := regexp_replace(m, '\D', '', 'g');
    if length(digits) in (10, 11) then digits := '55' || digits; end if;
    if length(digits) in (12, 13) and left(digits, 2) = '55' then return digits; end if;
  end loop;
  return null;
end;
$$;

-- Mensagem recebida no direct do Instagram (chamada pela Edge Function instagram-webhook)
create or replace function public.ig_inbound(
  p_ig_id text, p_username text, p_name text, p_message_id text, p_text text, p_raw jsonb, p_ts timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  d public.deals;
  pipe public.pipelines;
  first_stage public.stages;
  v_phone text := public.extract_br_phone(p_text);
  display_name text := coalesce(nullif(p_name, ''), nullif(p_username, ''), 'Instagram ' || p_ig_id);
  created_contact boolean := false;
  created_deal boolean := false;
begin
  if p_message_id is not null and exists (select 1 from public.wa_messages where wa_message_id = p_message_id) then
    return jsonb_build_object('duplicate', true);
  end if;

  -- contato: pelo IGSID, senão pelo telefone, senão cria
  select * into c from public.contacts where ig_id = p_ig_id;
  if c.id is null and v_phone is not null then
    select * into c from public.contacts where wa_id = v_phone or public.normalize_phone(contacts.phone) = v_phone limit 1;
  end if;
  if c.id is null then
    insert into public.contacts (name, phone, wa_id, ig_id, ig_username, source, tags)
    values (display_name, case when v_phone is not null then '+' || v_phone end, v_phone, p_ig_id, p_username, 'Instagram', array['instagram'])
    returning * into c;
    created_contact := true;
  else
    update public.contacts
       set ig_id = p_ig_id, ig_username = coalesce(p_username, ig_username),
           wa_id = coalesce(contacts.wa_id, v_phone), phone = coalesce(contacts.phone, case when v_phone is not null then '+' || v_phone end),
           name = case when name like 'Instagram %' then display_name else name end
     where id = c.id returning * into c;
  end if;

  insert into public.wa_messages (contact_id, direction, wa_message_id, type, body, status, raw, channel, created_at)
  values (c.id, 'in', p_message_id, 'text', p_text, 'received', p_raw, 'instagram', p_ts);

  if v_phone is null then
    -- sem número: não entra na sequência; avisa o responsável para pedir o número
    if not exists (select 1 from public.activities where contact_id = c.id and done = false and title like 'Instagram: pedir número%') then
      insert into public.activities (type, title, description, due_at, contact_id, assigned_to, created_by)
      values ('note', 'Instagram: pedir número — ' || c.name, 'Mensagem no direct sem celular: "' || left(p_text, 200) || '"', now(), c.id,
              (select id from public.profiles where role = 'admin' and active order by created_at limit 1),
              (select id from public.profiles where role = 'admin' and active order by created_at limit 1));
    end if;
    return jsonb_build_object('contact_id', c.id, 'phone_found', false, 'created_contact', created_contact);
  end if;

  -- funil de cadência
  select p.* into pipe from public.pipelines p
   where exists (select 1 from public.stages s where s.pipeline_id = p.id and s.role = 'day')
   order by p.is_default desc, p.position limit 1;
  if pipe.id is null then return jsonb_build_object('contact_id', c.id, 'phone_found', true, 'error', 'sem funil de cadência'); end if;

  select * into d from public.deals where contact_id = c.id and pipeline_id = pipe.id and status = 'open' order by created_at desc limit 1;
  if d.id is null then
    select * into first_stage from public.stages where pipeline_id = pipe.id and role = 'day' order by position limit 1;
    insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, wa_number_id)
    values (c.name || ' — Instagram', pipe.id, first_stage.id, c.id,
            (select id from public.profiles where role = 'admin' and active order by created_at limit 1), public.default_wa_number())
    returning * into d;
    created_deal := true;
  end if;

  update public.org_settings set wa_last_event_at = now() where id = 1;
  return jsonb_build_object('contact_id', c.id, 'deal_id', d.id, 'phone', v_phone, 'phone_found', true, 'created_contact', created_contact, 'created_deal', created_deal);
end;
$$;
revoke execute on function public.ig_inbound(text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant  execute on function public.ig_inbound(text, text, text, text, text, jsonb, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- wa_inbound: agora recebe o número que atendeu (phone_number_id)
-- ---------------------------------------------------------------------
drop function public.wa_inbound(text, text, text, text, text, jsonb, timestamptz);
create or replace function public.wa_inbound(
  p_wa_id text, p_wa_name text, p_message_id text, p_type text, p_body text, p_raw jsonb,
  p_ts timestamptz default now(), p_phone_number_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  d public.deals;
  pipe public.pipelines;
  first_stage public.stages;
  resp_stage public.stages;
  cur public.stages;
  num_id uuid;
  created_contact boolean := false;
  created_deal boolean := false;
  moved boolean := false;
begin
  if p_message_id is not null and exists (select 1 from public.wa_messages where wa_message_id = p_message_id) then
    return jsonb_build_object('duplicate', true);
  end if;

  select id into num_id from public.wa_numbers where phone_number_id = p_phone_number_id;
  num_id := coalesce(num_id, public.default_wa_number());

  select * into c from public.contacts where wa_id = p_wa_id;
  if c.id is null then select * into c from public.contacts where public.normalize_phone(phone) = p_wa_id limit 1; end if;
  if c.id is null then
    insert into public.contacts (name, phone, wa_id, wa_name, source, tags)
    values (coalesce(nullif(p_wa_name, ''), '+' || p_wa_id), '+' || p_wa_id, p_wa_id, p_wa_name, 'WhatsApp', array['whatsapp'])
    returning * into c;
    created_contact := true;
  else
    update public.contacts set wa_id = p_wa_id, wa_name = coalesce(p_wa_name, wa_name) where id = c.id;
  end if;

  select p.* into pipe from public.pipelines p
   where exists (select 1 from public.stages s where s.pipeline_id = p.id and s.role = 'day')
   order by p.is_default desc, p.position limit 1;

  if pipe.id is not null then
    select * into d from public.deals where contact_id = c.id and pipeline_id = pipe.id and status = 'open' order by created_at desc limit 1;
    if d.id is null then
      -- lead chegou direto pelo WhatsApp (sem passar pelo Instagram): entra no Dia 1 dentro da janela de 24h
      select * into first_stage from public.stages where pipeline_id = pipe.id and role = 'day' order by position limit 1;
      insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, last_inbound_at, wa_number_id)
      values (coalesce(nullif(c.name, ''), '+' || p_wa_id) || ' — WhatsApp', pipe.id, first_stage.id, c.id,
              (select id from public.profiles where role = 'admin' and active order by created_at limit 1), p_ts, num_id)
      returning * into d;
      created_deal := true;
    else
      select * into cur from public.stages where id = d.stage_id;
      select * into resp_stage from public.stages where pipeline_id = pipe.id and role = 'responsive' order by position limit 1;
      if cur.role in ('day', 'archived', 'reactivate') and resp_stage.id is not null then
        update public.deals set stage_id = resp_stage.id, last_inbound_at = p_ts, wa_number_id = coalesce(wa_number_id, num_id) where id = d.id;
        moved := true;
      else
        update public.deals set last_inbound_at = p_ts, wa_number_id = coalesce(wa_number_id, num_id) where id = d.id;
      end if;
    end if;
  end if;

  insert into public.wa_messages (contact_id, deal_id, direction, wa_message_id, type, body, status, raw, channel, created_at)
  values (c.id, d.id, 'in', p_message_id, coalesce(p_type, 'text'), p_body, 'received', p_raw, 'whatsapp', p_ts);

  update public.org_settings set wa_connected = true, wa_last_event_at = now() where id = 1;
  return jsonb_build_object('contact_id', c.id, 'deal_id', d.id, 'created_contact', created_contact, 'created_deal', created_deal, 'moved_to_responsive', moved);
end;
$$;
revoke execute on function public.wa_inbound(text, text, text, text, text, jsonb, timestamptz, text) from public, anon, authenticated;
grant  execute on function public.wa_inbound(text, text, text, text, text, jsonb, timestamptz, text) to service_role;

-- ---------------------------------------------------------------------
-- Fila de envio: guarda o número remetente
-- ---------------------------------------------------------------------
alter table public.wa_outbox add column wa_number_id uuid references public.wa_numbers(id) on delete set null;
alter table public.wa_messages add column wa_number_id uuid references public.wa_numbers(id) on delete set null;

create or replace function public.queue_stage_message(d public.deals, st public.stages)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  msg text;
begin
  select * into c from public.contacts where id = d.contact_id;
  if c.id is null or c.wa_id is null then return; end if;
  msg := public.render_message(st.message_text, c);

  if st.auto_send and (st.wa_template_name is not null or public.in_wa_window(d)) then
    if public.in_wa_window(d) and msg <> '' then
      insert into public.wa_outbox (contact_id, deal_id, kind, body, wa_number_id) values (c.id, d.id, 'text', msg, coalesce(d.wa_number_id, public.default_wa_number()));
    else
      insert into public.wa_outbox (contact_id, deal_id, kind, template_name, template_lang, template_params, wa_number_id)
      values (c.id, d.id, 'template', st.wa_template_name, st.wa_template_lang, jsonb_build_array(split_part(c.name, ' ', 1)), coalesce(d.wa_number_id, public.default_wa_number()));
    end if;
  else
    insert into public.activities (type, title, description, due_at, deal_id, contact_id, assigned_to, created_by)
    values ('whatsapp', 'Enviar mensagem — ' || st.name || ': ' || d.title, nullif(msg, ''), now(), d.id, c.id, d.owner_id, d.owner_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Motor: arquivado vence o prazo → volta ao Dia 1 (ou à coluna 'reactivate', se existir)
-- ---------------------------------------------------------------------
create or replace function public.run_cadence()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  nxt public.stages;
  advanced int := 0;
  archived int := 0;
  restarted int := 0;
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
    select d.id as deal_id, d.pipeline_id, d.owner_id, d.title, d.contact_id, d.cycle
      from public.deals d join public.stages s on s.id = d.stage_id
     where s.role = 'archived' and d.reactivate_at is not null and d.reactivate_at <= current_date
  loop
    -- se o funil tiver uma coluna "Reativar" (manual), usa ela; senão recomeça a sequência no primeiro dia
    select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'reactivate' order by position limit 1;
    if nxt.id is null then
      select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'day' order by position limit 1;
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

  return jsonb_build_object('advanced', advanced, 'archived', archived, 'reactivated', restarted);
end;
$$;

-- ---------------------------------------------------------------------
-- Funil padrão: sem coluna "Reativar" (o lead volta ao Dia 1 sozinho);
-- Dia 1 agora precisa de template (é mensagem iniciada pela empresa)
-- ---------------------------------------------------------------------
delete from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and role = 'reactivate'
  and not exists (select 1 from public.deals where stage_id = stages.id);
update public.stages set wa_template_name = 'mentoria_dia_' || (position + 1)
  where pipeline_id = '00000000-0000-0000-0000-000000000002' and role = 'day' and wa_template_name is null;
update public.pipelines set name = 'Mentoria — Instagram → WhatsApp' where id = '00000000-0000-0000-0000-000000000002';
