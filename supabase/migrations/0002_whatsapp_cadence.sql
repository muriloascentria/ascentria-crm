-- =====================================================================
-- Ascentria CRM — Cadência de WhatsApp (Meta Cloud API)
-- Colunas com regras de avanço, mensagens, fila de envio e motor diário
-- =====================================================================

-- ---------------------------------------------------------------------
-- Colunas (stages): papel na cadência e regras
--   role: 'day'        coluna de um dia da sequência (Dia 1, Dia 2, ...)
--         'responsive' lead respondeu
--         'archived'   sem resposta, aguardando reativação
--         'reactivate' passou o prazo de arquivamento: chamar de novo
--         null         coluna comum
-- ---------------------------------------------------------------------
alter table public.stages
  add column role              text check (role in ('day','responsive','archived','reactivate')),
  add column advance_after_days int,            -- avança para a próxima coluna após N dias sem resposta
  add column message_text      text,            -- mensagem do dia (texto livre; usada na janela de 24h ou como roteiro)
  add column wa_template_name  text,            -- template aprovado na Meta (obrigatório fora da janela de 24h)
  add column wa_template_lang  text not null default 'pt_BR',
  add column auto_send         boolean not null default false; -- true: envia sozinho; false: cria tarefa para enviar manualmente

alter table public.pipelines
  add column archive_months int not null default 4;   -- meses até reativar um lead arquivado

alter table public.deals
  add column stage_entered_at timestamptz not null default now(),
  add column reactivate_at    date,
  add column last_inbound_at  timestamptz,           -- última mensagem recebida do lead (janela de 24h)
  add column last_outbound_at timestamptz;

alter table public.contacts
  add column wa_id   text,                            -- número no formato da Meta (só dígitos, com DDI): 5548999990000
  add column wa_name text;                            -- nome do perfil no WhatsApp
create unique index contacts_wa_id_key on public.contacts (wa_id) where wa_id is not null;

-- marca o momento de entrada na coluna
create or replace function public.deals_touch_stage()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;
create trigger deals_touch_stage before insert or update on public.deals
  for each row execute function public.deals_touch_stage();

-- ---------------------------------------------------------------------
-- Mensagens de WhatsApp (histórico) e fila de envio
-- ---------------------------------------------------------------------
create table public.wa_messages (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references public.contacts(id) on delete cascade,
  deal_id       uuid references public.deals(id) on delete set null,
  direction     text not null check (direction in ('in','out')),
  wa_message_id text unique,
  type          text not null default 'text',        -- text | template | image | audio | ...
  body          text,
  template_name text,
  status        text,                                -- sent | delivered | read | failed | received
  error         text,
  sent_by       uuid references public.profiles(id) on delete set null,
  raw           jsonb,
  created_at    timestamptz not null default now()
);
create index on public.wa_messages (contact_id, created_at desc);
create index on public.wa_messages (deal_id, created_at desc);

create table public.wa_outbox (
  id             bigserial primary key,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  deal_id        uuid references public.deals(id) on delete cascade,
  kind           text not null check (kind in ('text','template')),
  body           text,
  template_name  text,
  template_lang  text default 'pt_BR',
  template_params jsonb not null default '[]'::jsonb, -- ["{{1}}", "{{2}}"...]
  status         text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts       int not null default 0,
  error          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index on public.wa_outbox (status, created_at);

-- Configuração visível do WhatsApp (tokens ficam nos secrets das Edge Functions, nunca aqui)
alter table public.org_settings
  add column wa_phone_display  text,                      -- ex.: +55 48 99999-0000 (só para exibição)
  add column wa_connected      boolean not null default false,
  add column wa_last_event_at  timestamptz;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  select case
    when p is null then null
    else (
      with d as (select regexp_replace(p, '\D', '', 'g') as n)
      select case
        when length(n) in (10, 11) then '55' || n       -- número brasileiro sem DDI
        else n
      end from d
    )
  end
$$;

-- substitui variáveis {{nome}} {{primeiro_nome}} {{empresa}} na mensagem
create or replace function public.render_message(tpl text, c public.contacts)
returns text language plpgsql as $$
declare
  first_name text := split_part(coalesce(c.name, ''), ' ', 1);
begin
  tpl := coalesce(tpl, '');
  tpl := replace(tpl, '{{nome}}', coalesce(c.name, ''));
  tpl := replace(tpl, '{{primeiro_nome}}', first_name);
  return tpl;
end;
$$;

-- Está dentro da janela de 24h desde a última mensagem do lead?
create or replace function public.in_wa_window(d public.deals)
returns boolean language sql stable as $$
  select d.last_inbound_at is not null and d.last_inbound_at > now() - interval '24 hours'
$$;

-- ---------------------------------------------------------------------
-- Enfileira a mensagem de uma coluna para um negócio (ou cria tarefa manual)
-- ---------------------------------------------------------------------
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
      insert into public.wa_outbox (contact_id, deal_id, kind, body) values (c.id, d.id, 'text', msg);
    else
      insert into public.wa_outbox (contact_id, deal_id, kind, template_name, template_lang, template_params)
      values (c.id, d.id, 'template', st.wa_template_name, st.wa_template_lang, jsonb_build_array(split_part(c.name, ' ', 1)));
    end if;
  else
    -- envio manual: cria tarefa com o roteiro do dia
    insert into public.activities (type, title, description, due_at, deal_id, contact_id, assigned_to, created_by)
    values ('whatsapp', 'Enviar mensagem — ' || st.name || ': ' || d.title, nullif(msg, ''), now(), d.id, c.id, d.owner_id, d.owner_id);
  end if;
end;
$$;

-- Ao ENTRAR numa coluna de cadência, dispara a mensagem daquele dia
create or replace function public.deals_cadence_on_enter()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.stages;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    select * into st from public.stages where id = new.stage_id;
    if st.role = 'day' and (st.message_text is not null or st.wa_template_name is not null) then
      perform public.queue_stage_message(new, st);
    end if;
    if st.role = 'archived' then
      update public.deals set reactivate_at = current_date + ((select archive_months from public.pipelines where id = new.pipeline_id) || ' months')::interval
      where id = new.id;
    end if;
  end if;
  return null;
end;
$$;
create trigger deals_cadence_on_enter after insert or update of stage_id on public.deals
  for each row execute function public.deals_cadence_on_enter();

-- ---------------------------------------------------------------------
-- Entrada de mensagem do lead (chamada pela Edge Function do webhook)
--   Cria contato e negócio na 1ª coluna do funil de cadência; se já houver
--   negócio aberto em coluna de cadência, move para "Responsivo".
-- ---------------------------------------------------------------------
create or replace function public.wa_inbound(
  p_wa_id text, p_wa_name text, p_message_id text, p_type text, p_body text, p_raw jsonb, p_ts timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.contacts;
  d public.deals;
  pipe public.pipelines;
  first_stage public.stages;
  resp_stage public.stages;
  cur public.stages;
  created_contact boolean := false;
  created_deal boolean := false;
  moved boolean := false;
begin
  -- ignora duplicidade (a Meta pode reenviar)
  if p_message_id is not null and exists (select 1 from public.wa_messages where wa_message_id = p_message_id) then
    return jsonb_build_object('duplicate', true);
  end if;

  -- contato
  select * into c from public.contacts where wa_id = p_wa_id;
  if c.id is null then
    select * into c from public.contacts where public.normalize_phone(phone) = p_wa_id limit 1;
  end if;
  if c.id is null then
    insert into public.contacts (name, phone, wa_id, wa_name, source, tags)
    values (coalesce(nullif(p_wa_name, ''), '+' || p_wa_id), '+' || p_wa_id, p_wa_id, p_wa_name, 'WhatsApp', array['whatsapp'])
    returning * into c;
    created_contact := true;
  else
    update public.contacts set wa_id = p_wa_id, wa_name = coalesce(p_wa_name, wa_name) where id = c.id;
  end if;

  -- funil de cadência = o que possui colunas com role 'day'
  select p.* into pipe from public.pipelines p
   where exists (select 1 from public.stages s where s.pipeline_id = p.id and s.role = 'day')
   order by p.is_default desc, p.position limit 1;

  if pipe.id is not null then
    select * into d from public.deals
     where contact_id = c.id and pipeline_id = pipe.id and status = 'open'
     order by created_at desc limit 1;

    if d.id is null then
      select * into first_stage from public.stages where pipeline_id = pipe.id and role = 'day' order by position limit 1;
      insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, last_inbound_at)
      values (coalesce(nullif(c.name, ''), '+' || p_wa_id) || ' — WhatsApp', pipe.id, first_stage.id, c.id,
              (select id from public.profiles where role = 'admin' and active order by created_at limit 1), p_ts)
      returning * into d;
      created_deal := true;
    else
      select * into cur from public.stages where id = d.stage_id;
      select * into resp_stage from public.stages where pipeline_id = pipe.id and role = 'responsive' order by position limit 1;
      if cur.role in ('day', 'archived', 'reactivate') and resp_stage.id is not null then
        update public.deals set stage_id = resp_stage.id, last_inbound_at = p_ts where id = d.id;
        moved := true;
      else
        update public.deals set last_inbound_at = p_ts where id = d.id;
      end if;
    end if;
  end if;

  insert into public.wa_messages (contact_id, deal_id, direction, wa_message_id, type, body, status, raw, created_at)
  values (c.id, d.id, 'in', p_message_id, coalesce(p_type, 'text'), p_body, 'received', p_raw, p_ts);

  update public.org_settings set wa_connected = true, wa_last_event_at = now() where id = 1;

  return jsonb_build_object('contact_id', c.id, 'deal_id', d.id, 'created_contact', created_contact, 'created_deal', created_deal, 'moved_to_responsive', moved);
end;
$$;

-- ---------------------------------------------------------------------
-- Motor diário da cadência (chamado pela Edge Function cadence-run)
-- ---------------------------------------------------------------------
create or replace function public.run_cadence()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  nxt public.stages;
  advanced int := 0;
  archived int := 0;
  reactivated int := 0;
begin
  -- 1) avança leads sem resposta que estouraram o prazo da coluna
  for r in
    select d.id as deal_id, d.pipeline_id, s.id as stage_id, s.position, s.advance_after_days
      from public.deals d join public.stages s on s.id = d.stage_id
     where d.status = 'open' and s.role = 'day' and s.advance_after_days is not null
       and d.stage_entered_at < now() - (s.advance_after_days || ' days')::interval
  loop
    -- próxima coluna de dia; se não houver, arquiva
    select * into nxt from public.stages
     where pipeline_id = r.pipeline_id and role = 'day' and position > r.position order by position limit 1;
    if nxt.id is null then
      select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'archived' order by position limit 1;
      if nxt.id is not null then archived := archived + 1; end if;
    else
      advanced := advanced + 1;
    end if;
    if nxt.id is not null then
      update public.deals set stage_id = nxt.id where id = r.deal_id;
    end if;
  end loop;

  -- 2) reativa arquivados que venceram o prazo
  for r in
    select d.id as deal_id, d.pipeline_id, d.owner_id, d.title, d.contact_id
      from public.deals d join public.stages s on s.id = d.stage_id
     where s.role = 'archived' and d.reactivate_at is not null and d.reactivate_at <= current_date
  loop
    select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'reactivate' order by position limit 1;
    if nxt.id is not null then
      update public.deals set stage_id = nxt.id, reactivate_at = null where id = r.deal_id;
      insert into public.activities (type, title, description, due_at, deal_id, contact_id, assigned_to, created_by)
      values ('whatsapp', 'Retomar contato: ' || r.title, 'Lead arquivado há 4 meses sem resposta. Hora de tentar de novo.', now(), r.deal_id, r.contact_id, r.owner_id, r.owner_id);
      reactivated := reactivated + 1;
    end if;
  end loop;

  return jsonb_build_object('advanced', advanced, 'archived', archived, 'reactivated', reactivated);
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.wa_messages enable row level security;
alter table public.wa_outbox   enable row level security;

create policy "wa_messages_select" on public.wa_messages for select to authenticated
  using (public.is_active_user() and exists (select 1 from public.contacts c where c.id = wa_messages.contact_id));
create policy "wa_messages_insert" on public.wa_messages for insert to authenticated with check (public.is_active_user());

create policy "wa_outbox_select" on public.wa_outbox for select to authenticated using (public.is_active_user());
create policy "wa_outbox_insert" on public.wa_outbox for insert to authenticated with check (public.is_active_user());
create policy "wa_outbox_admin"  on public.wa_outbox for all to authenticated using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());

-- As funções abaixo só devem ser chamadas pelas Edge Functions (service role)
revoke execute on function public.wa_inbound(text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.run_cadence() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Funil de cadência padrão: "Mentoria — WhatsApp"
-- ---------------------------------------------------------------------
insert into public.pipelines (id, name, position, is_default, archive_months)
values ('00000000-0000-0000-0000-000000000002', 'Mentoria — WhatsApp', 1, false, 4);

insert into public.stages (pipeline_id, name, position, color, probability, kind, role, advance_after_days, message_text, auto_send) values
  ('00000000-0000-0000-0000-000000000002', 'Dia 1', 0, '#9aa585', 10, 'open', 'day', 1,
   'Oi, {{primeiro_nome}}! Aqui é o Murilo, da Ascentria. Vi que você chamou aqui — me conta rapidinho: o que te trouxe até a mentoria?', false),
  ('00000000-0000-0000-0000-000000000002', 'Dia 2', 1, '#818a66', 15, 'open', 'day', 1,
   '{{primeiro_nome}}, passando pra te mostrar como funciona a mentoria na prática. Posso te mandar um áudio de 1 minuto explicando?', false),
  ('00000000-0000-0000-0000-000000000002', 'Dia 3', 2, '#6f7d52', 20, 'open', 'day', 1,
   'Uma história rápida: um mentorado chegou com o mesmo desafio que você e em 90 dias virou o jogo. Quer que eu te conte como?', false),
  ('00000000-0000-0000-0000-000000000002', 'Dia 4', 3, '#c9973f', 25, 'open', 'day', 1,
   '{{primeiro_nome}}, tenho 2 vagas abertas nesta turma. Faz sentido a gente conversar 15 minutos essa semana?', false),
  ('00000000-0000-0000-0000-000000000002', 'Dia 5', 4, '#ab6f30', 30, 'open', 'day', 1,
   'Última mensagem por aqui: se quiser retomar depois, é só me chamar. Deixo a porta aberta. 🙂', false),
  ('00000000-0000-0000-0000-000000000002', 'Responsivo', 5, '#5c7a3a', 60, 'open', 'responsive', null, null, false),
  ('00000000-0000-0000-0000-000000000002', 'Arquivado', 6, '#cfc9b6', 0, 'open', 'archived', null, null, false),
  ('00000000-0000-0000-0000-000000000002', 'Reativar', 7, '#f97316', 20, 'open', 'reactivate', null, null, false),
  ('00000000-0000-0000-0000-000000000002', 'Fechou mentoria', 8, '#2e381a', 100, 'won', null, null, null, false),
  ('00000000-0000-0000-0000-000000000002', 'Perdido', 9, '#a8432f', 0, 'lost', null, null, null, false);

grant execute on function public.wa_inbound(text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.run_cadence() to service_role;
