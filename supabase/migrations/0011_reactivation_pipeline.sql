-- =====================================================================
-- Funil de Reativação
--  * pipelines.reactivate_to_pipeline_id: para onde vai o lead que venceu o prazo no Arquivado.
--    NULL = volta ao Dia 1 do próprio funil (comportamento anterior).
--  * Mentoria → (4 meses arquivado) → Reativação → (4 meses arquivado) → Dia 1 da Reativação.
--  * Mensagens recebidas no WhatsApp continuam no funil em que o lead já está (Mentoria ou
--    Reativação); lead novo entra no funil de entrada (o que tem coluna Recebidos).
-- =====================================================================

alter table public.pipelines
  add column if not exists reactivate_to_pipeline_id uuid references public.pipelines(id) on delete set null;

-- Funil de entrada dos leads novos: o que tem coluna "Recebidos"; senão, o primeiro com colunas de dia.
create or replace function public.entry_pipeline()
returns uuid language sql stable set search_path = public as $$
  select p.id from public.pipelines p
   where exists (select 1 from public.stages s where s.pipeline_id = p.id and s.role = 'day')
   order by exists (select 1 from public.stages s where s.pipeline_id = p.id and s.role = 'inbox') desc,
            p.is_default desc, p.position
   limit 1
$$;

-- Negócio aberto do contato em qualquer funil de cadência (o mais recente).
create or replace function public.open_cadence_deal(p_contact uuid)
returns uuid language sql stable set search_path = public as $$
  select d.id from public.deals d
   where d.contact_id = p_contact and d.status = 'open'
     and exists (select 1 from public.stages s where s.pipeline_id = d.pipeline_id and s.role = 'day')
   order by d.created_at desc
   limit 1
$$;

revoke execute on function public.entry_pipeline() from public, anon;
revoke execute on function public.open_cadence_deal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Motor: reativação pode mandar o lead para outro funil
-- ---------------------------------------------------------------------
create or replace function public.run_cadence()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  nxt public.stages;
  target uuid;
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
    select d.id as deal_id, d.pipeline_id, d.owner_id, d.title, d.contact_id, d.cycle, p.reactivate_to_pipeline_id
      from public.deals d
      join public.stages s on s.id = d.stage_id
      join public.pipelines p on p.id = d.pipeline_id
     where s.role = 'archived' and d.reactivate_at is not null and d.reactivate_at <= current_date
  loop
    nxt := null;
    target := r.reactivate_to_pipeline_id;
    if target is not null and target <> r.pipeline_id then
      -- vai para o Dia 1 do funil de destino (ex.: Mentoria → Reativação)
      select * into nxt from public.stages where pipeline_id = target and role = 'day' order by position limit 1;
    end if;
    if nxt.id is null then
      -- mesmo funil: coluna "Reativar" (manual), se existir; senão recomeça no primeiro dia
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

  return jsonb_build_object('advanced', advanced, 'archived', archived, 'reactivated', restarted);
end;
$$;

-- ---------------------------------------------------------------------
-- ig_inbound: usa o negócio aberto do contato (qualquer funil de cadência) ou o funil de entrada
-- ---------------------------------------------------------------------
create or replace function public.ig_inbound(
  p_ig_id text, p_username text, p_name text, p_message_id text, p_text text, p_raw jsonb, p_ts timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  d public.deals;
  pipe_id uuid;
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

  select * into d from public.deals where id = public.open_cadence_deal(c.id);
  if d.id is null then
    pipe_id := public.entry_pipeline();
    if pipe_id is null then return jsonb_build_object('contact_id', c.id, 'phone_found', true, 'error', 'sem funil de cadência'); end if;
    insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, wa_number_id)
    values (c.name || ' — Instagram', pipe_id, coalesce(public.entry_stage(pipe_id), public.first_day_stage(pipe_id)), c.id, admin_id, public.default_wa_number())
    returning * into d;
    created_deal := true;
  end if;

  update public.org_settings set wa_last_event_at = now() where id = 1;
  return jsonb_build_object('contact_id', c.id, 'deal_id', d.id, 'phone', v_phone, 'phone_found', true, 'created_contact', created_contact, 'created_deal', created_deal);
end;
$$;

-- ---------------------------------------------------------------------
-- wa_inbound: a resposta move o lead para o Responsivo do funil em que ele está
-- ---------------------------------------------------------------------
create or replace function public.wa_inbound(
  p_wa_id text, p_wa_name text, p_message_id text, p_type text, p_body text, p_raw jsonb,
  p_ts timestamptz default now(), p_phone_number_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  d public.deals;
  pipe_id uuid;
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

  select * into d from public.deals where id = public.open_cadence_deal(c.id);
  pipe_id := coalesce(d.pipeline_id, public.entry_pipeline());

  if pipe_id is not null then
    select * into resp_stage from public.stages where pipeline_id = pipe_id and role = 'responsive' order by position limit 1;
    if d.id is null then
      -- escreveu direto no WhatsApp: já é um lead responsivo (a janela de 24h está aberta)
      insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, last_inbound_at, wa_number_id)
      values (coalesce(nullif(c.name, ''), '+' || p_wa_id) || ' — WhatsApp', pipe_id,
              coalesce(resp_stage.id, public.entry_stage(pipe_id), public.first_day_stage(pipe_id)), c.id, admin_id, p_ts, num_id)
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
-- Funil "Reativação" (ID fixo ...0003)
-- ---------------------------------------------------------------------
insert into public.pipelines (id, name, position, is_default, archive_months, daily_limit)
values ('00000000-0000-0000-0000-000000000003', 'Reativação', 2, false, 4, 250)
on conflict (id) do nothing;

insert into public.stages (pipeline_id, name, position, color, probability, kind, role, advance_after_days, message_text, wa_template_name, wa_template_lang, auto_send)
select '00000000-0000-0000-0000-000000000003', v.name, v.pos, v.color, v.prob, v.kind, v.role, v.adv, v.msg, v.tpl, 'pt_BR', v.auto
from (values
  ('Dia 1', 0, '#9aa585', 10, 'open', 'day', 1, E'Oi, {{primeiro_nome}}! Aqui é a Mari, do time do enfermeiro Murilo Pedroso. Há alguns meses você demonstrou interesse na consultoria gratuita para estruturar seu consultório de enfermagem. Como estão as coisas por aí? Esse ainda é um objetivo seu?', 'reativacao_dia_1', true),
  ('Dia 2', 1, '#818a66', 15, 'open', 'day', 1, E'Oi, {{primeiro_nome}}! Uma pergunta rápida: hoje, o que mais te impede de fazer seu consultório de enfermagem faturar mais? Pode me responder em uma frase que eu te ajudo a partir daí.', 'reativacao_dia_2', true),
  ('Dia 3', 2, '#6f7d52', 20, 'open', 'day', 1, E'Oi, {{primeiro_nome}}! O enfermeiro Murilo abriu novos horários para a consultoria gratuita. Nela, ele ajuda você a estruturar seu consultório com a meta de faturar pelo menos R$ 10 mil por mês. Quer que eu te envie as opções?', 'reativacao_dia_3', true),
  ('Dia 4', 3, '#c9973f', 25, 'open', 'day', 1, E'Oi, {{primeiro_nome}}! Ainda tenho alguns horários livres nesta semana para a consultoria gratuita. Posso reservar um para você?', 'reativacao_dia_4', true),
  ('Dia 5', 4, '#ab6f30', 30, 'open', 'day', 1, E'Oi, {{primeiro_nome}}, esta é minha última mensagem por agora sobre a consultoria gratuita.\nSe quiser agendar, responda SIM que te envio os horários. Se não for o momento, responda NÃO e encerro o contato por aqui.', 'reativacao_dia_5', true),
  ('Responsivo', 5, '#5c7a3a', 60, 'open', 'responsive', null, null, null, false),
  ('Arquivado', 6, '#cfc9b6', 0, 'open', 'archived', null, null, null, false),
  ('Fechou mentoria', 7, '#2e381a', 100, 'won', null, null, null, null, false),
  ('Perdido', 8, '#a8432f', 0, 'lost', null, null, null, null, false)
) as v(name, pos, color, prob, kind, role, adv, msg, tpl, auto)
where not exists (select 1 from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000003');

-- Mentoria: depois de 4 meses arquivado, vai para a Reativação (e não volta mais ao Dia 1 da Mentoria)
update public.pipelines set reactivate_to_pipeline_id = '00000000-0000-0000-0000-000000000003'
 where id = '00000000-0000-0000-0000-000000000002';
