-- =====================================================================
-- Ascentria CRM — Coluna de recebimento ("Recebidos")
-- Leads do Instagram caem aqui sem envio. A passagem para o Dia 1 é manual
-- (arrastar / mover em lote), respeitando o limite diário da Meta.
-- =====================================================================

alter table public.stages drop constraint if exists stages_role_check;
alter table public.stages add constraint stages_role_check
  check (role in ('inbox','day','responsive','archived','reactivate'));

-- limite diário de conversas iniciadas pela empresa (Meta: 250 sem verificação; depois 1.000 / 10.000 / 100.000)
alter table public.pipelines add column daily_limit int not null default 250;

-- ---------------------------------------------------------------------
-- Entrada: coluna de recebimento se existir, senão primeiro dia
-- ---------------------------------------------------------------------
create or replace function public.entry_stage(p_pipeline uuid)
returns uuid language sql stable as $$
  select id from public.stages where pipeline_id = p_pipeline and role = 'inbox' order by position limit 1
$$;

create or replace function public.first_day_stage(p_pipeline uuid)
returns uuid language sql stable as $$
  select id from public.stages where pipeline_id = p_pipeline and role = 'day' order by position limit 1
$$;

-- ig_inbound: cria o negócio na coluna de recebimento
create or replace function public.ig_inbound(
  p_ig_id text, p_username text, p_name text, p_message_id text, p_text text, p_raw jsonb, p_ts timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  d public.deals;
  pipe public.pipelines;
  v_phone text := public.extract_br_phone(p_text);
  display_name text := coalesce(nullif(p_name, ''), nullif(p_username, ''), 'Instagram ' || p_ig_id);
  admin_id uuid := (select id from public.profiles where role = 'admin' and active order by created_at limit 1);
  created_contact boolean := false;
  created_deal boolean := false;
begin
  if p_message_id is not null and exists (select 1 from public.wa_messages where wa_message_id = p_message_id) then
    return jsonb_build_object('duplicate', true);
  end if;

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
    if not exists (select 1 from public.activities where contact_id = c.id and done = false and title like 'Instagram: pedir número%') then
      insert into public.activities (type, title, description, due_at, contact_id, assigned_to, created_by)
      values ('note', 'Instagram: pedir número — ' || c.name, 'Mensagem no direct sem celular: "' || left(p_text, 200) || '"', now(), c.id, admin_id, admin_id);
    end if;
    return jsonb_build_object('contact_id', c.id, 'phone_found', false, 'created_contact', created_contact);
  end if;

  select p.* into pipe from public.pipelines p
   where exists (select 1 from public.stages s where s.pipeline_id = p.id and s.role = 'day')
   order by p.is_default desc, p.position limit 1;
  if pipe.id is null then return jsonb_build_object('contact_id', c.id, 'phone_found', true, 'error', 'sem funil de cadência'); end if;

  select * into d from public.deals where contact_id = c.id and pipeline_id = pipe.id and status = 'open' order by created_at desc limit 1;
  if d.id is null then
    insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, wa_number_id)
    values (c.name || ' — Instagram', pipe.id, coalesce(public.entry_stage(pipe.id), public.first_day_stage(pipe.id)), c.id, admin_id, public.default_wa_number())
    returning * into d;
    created_deal := true;
  end if;

  update public.org_settings set wa_last_event_at = now() where id = 1;
  return jsonb_build_object('contact_id', c.id, 'deal_id', d.id, 'phone', v_phone, 'phone_found', true, 'created_contact', created_contact, 'created_deal', created_deal);
end;
$$;

-- wa_inbound: lead que escreve no WhatsApp estando em Recebidos também vai para Responsivo;
-- lead novo direto pelo WhatsApp entra em Recebidos (não dispara sequência sozinho)
create or replace function public.wa_inbound(
  p_wa_id text, p_wa_name text, p_message_id text, p_type text, p_body text, p_raw jsonb,
  p_ts timestamptz default now(), p_phone_number_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  d public.deals;
  pipe public.pipelines;
  resp_stage public.stages;
  cur public.stages;
  num_id uuid;
  admin_id uuid := (select id from public.profiles where role = 'admin' and active order by created_at limit 1);
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
    select * into resp_stage from public.stages where pipeline_id = pipe.id and role = 'responsive' order by position limit 1;
    if d.id is null then
      -- escreveu direto no WhatsApp: já é um lead responsivo (a janela de 24h está aberta)
      insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, last_inbound_at, wa_number_id)
      values (coalesce(nullif(c.name, ''), '+' || p_wa_id) || ' — WhatsApp', pipe.id,
              coalesce(resp_stage.id, public.entry_stage(pipe.id), public.first_day_stage(pipe.id)), c.id, admin_id, p_ts, num_id)
      returning * into d;
      created_deal := true;
    else
      select * into cur from public.stages where id = d.stage_id;
      if cur.role in ('inbox', 'day', 'archived', 'reactivate') and resp_stage.id is not null then
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

-- ---------------------------------------------------------------------
-- Mover em lote: os N leads mais antigos de "Recebidos" para o Dia 1
-- (chamada pelo botão da coluna; respeita RLS via checagem de usuário ativo)
-- ---------------------------------------------------------------------
create or replace function public.move_inbox_to_day1(p_pipeline uuid, p_count int)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  inbox uuid := public.entry_stage(p_pipeline);
  day1 uuid := public.first_day_stage(p_pipeline);
begin
  if not public.is_active_user() then raise exception 'Não autorizado'; end if;
  if inbox is null or day1 is null then return 0; end if;
  with sel as (
    select id from public.deals where stage_id = inbox and status = 'open'
    order by created_at limit greatest(p_count, 0)
  )
  update public.deals d set stage_id = day1 from sel where d.id = sel.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- envios iniciados pela empresa nas últimas 24h (para comparar com o limite da Meta)
create or replace function public.sent_last_24h()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.wa_messages
   where direction = 'out' and type = 'template' and created_at > now() - interval '24 hours'
$$;

-- ---------------------------------------------------------------------
-- Funil padrão: insere "Recebidos" na frente
-- ---------------------------------------------------------------------
update public.stages set position = position + 1 where pipeline_id = '00000000-0000-0000-0000-000000000002';
insert into public.stages (pipeline_id, name, position, color, probability, kind, role)
select '00000000-0000-0000-0000-000000000002', 'Recebidos', 0, '#babec6', 5, 'open', 'inbox'
 where not exists (select 1 from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and role = 'inbox');
