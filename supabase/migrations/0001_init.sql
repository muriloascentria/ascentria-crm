-- =====================================================================
-- Ascentria CRM — schema inicial
-- Tabelas, funções auxiliares, automações e RLS
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Perfis de usuário (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'seller' check (role in ('admin','manager','seller')),
  team        text,
  active      boolean not null default false,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Configurações da organização (linha única)
-- ---------------------------------------------------------------------
create table public.org_settings (
  id                int primary key default 1 check (id = 1),
  company_name      text not null default 'Ascentria',
  logo_url          text,
  primary_color     text not null default '#2e381a',
  accent_color      text not null default '#ab6f30',
  currency          text not null default 'BRL',
  -- Visibilidade de registros para vendedores: 'all' (todos veem tudo) ou 'own' (só os próprios)
  seller_visibility text not null default 'all' check (seller_visibility in ('all','own')),
  -- Rótulos personalizáveis das seções do sistema
  labels            jsonb not null default '{
    "contacts": "Contatos", "companies": "Empresas", "deals": "Negócios",
    "pipeline": "Funil", "activities": "Atividades", "dashboard": "Painel"
  }'::jsonb,
  updated_at        timestamptz not null default now()
);
insert into public.org_settings (id) values (1);

-- ---------------------------------------------------------------------
-- Funis e etapas
-- ---------------------------------------------------------------------
create table public.pipelines (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  position    int not null default 0,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.stages (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references public.pipelines(id) on delete cascade,
  name         text not null,
  position     int not null default 0,
  color        text not null default '#64748b',
  probability  int not null default 50 check (probability between 0 and 100),
  kind         text not null default 'open' check (kind in ('open','won','lost')),
  created_at   timestamptz not null default now()
);
create index on public.stages (pipeline_id, position);

-- ---------------------------------------------------------------------
-- Empresas e contatos
-- ---------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  domain      text,
  phone       text,
  segment     text,
  city        text,
  notes       text,
  owner_id    uuid references public.profiles(id) on delete set null,
  custom      jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  phone       text,
  job_title   text,
  source      text,
  tags        text[] not null default '{}',
  notes       text,
  company_id  uuid references public.companies(id) on delete set null,
  owner_id    uuid references public.profiles(id) on delete set null,
  custom      jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.contacts (company_id);
create index on public.contacts (owner_id);

-- ---------------------------------------------------------------------
-- Negócios (deals)
-- ---------------------------------------------------------------------
create table public.deals (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  value           numeric(14,2) not null default 0,
  pipeline_id     uuid not null references public.pipelines(id) on delete restrict,
  stage_id        uuid not null references public.stages(id) on delete restrict,
  contact_id      uuid references public.contacts(id) on delete set null,
  company_id      uuid references public.companies(id) on delete set null,
  owner_id        uuid references public.profiles(id) on delete set null,
  status          text not null default 'open' check (status in ('open','won','lost')),
  expected_close  date,
  closed_at       timestamptz,
  lost_reason     text,
  position        int not null default 0,
  custom          jsonb not null default '{}'::jsonb,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.deals (pipeline_id, stage_id, position);
create index on public.deals (owner_id);
create index on public.deals (contact_id);

create table public.deal_stage_history (
  id            bigserial primary key,
  deal_id       uuid not null references public.deals(id) on delete cascade,
  from_stage_id uuid,
  to_stage_id   uuid,
  changed_by    uuid,
  changed_at    timestamptz not null default now()
);
create index on public.deal_stage_history (deal_id);

-- ---------------------------------------------------------------------
-- Atividades (tarefas, ligações, reuniões, notas)
-- ---------------------------------------------------------------------
create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  type         text not null default 'task' check (type in ('task','call','meeting','email','whatsapp','note')),
  title        text not null,
  description  text,
  due_at       timestamptz,
  done         boolean not null default false,
  done_at      timestamptz,
  deal_id      uuid references public.deals(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete cascade,
  assigned_to  uuid references public.profiles(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.activities (assigned_to, done, due_at);
create index on public.activities (deal_id);
create index on public.activities (contact_id);

-- ---------------------------------------------------------------------
-- Campos personalizados (definições; os valores ficam em <tabela>.custom)
-- ---------------------------------------------------------------------
create table public.custom_fields (
  id        uuid primary key default gen_random_uuid(),
  entity    text not null check (entity in ('contact','company','deal')),
  key       text not null,
  label     text not null,
  type      text not null default 'text' check (type in ('text','number','date','select','checkbox','url','textarea')),
  options   jsonb not null default '[]'::jsonb,   -- para type = select
  required  boolean not null default false,
  position  int not null default 0,
  unique (entity, key)
);

-- ---------------------------------------------------------------------
-- Automações
--  trigger_type: deal_created | deal_stage_changed | deal_won | deal_lost | contact_created
--  trigger_config: { "stage_id": "..." } (para deal_stage_changed)
--  action_type: create_activity | set_deal_field | add_tag
--  action_config:
--    create_activity: { "type":"call", "title":"Ligar para {{deal.title}}", "days_offset":1, "assign":"owner" }
--    set_deal_field:  { "field":"probability|status|value", "value": ... }
--    add_tag:         { "tag": "quente" }
-- ---------------------------------------------------------------------
create table public.automations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  trigger_type    text not null check (trigger_type in ('deal_created','deal_stage_changed','deal_won','deal_lost','contact_created')),
  trigger_config  jsonb not null default '{}'::jsonb,
  action_type     text not null check (action_type in ('create_activity','set_deal_field','add_tag')),
  action_config   jsonb not null default '{}'::jsonb,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.automation_runs (
  id             bigserial primary key,
  automation_id  uuid references public.automations(id) on delete cascade,
  entity         text,
  entity_id      uuid,
  ok             boolean not null default true,
  message        text,
  ran_at         timestamptz not null default now()
);

-- =====================================================================
-- Funções auxiliares
-- =====================================================================
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_manager_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','manager') and active from public.profiles where id = auth.uid()), false)
$$;

-- Pode ver/editar um registro cujo dono é owner_id?
create or replace function public.can_access(owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (
    public.is_manager_or_admin()
    or (select seller_visibility from public.org_settings where id = 1) = 'all'
    or owner_id = auth.uid()
    or owner_id is null
  )
$$;

-- Cria o perfil automaticamente ao registrar. O primeiro usuário vira admin ativo.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when first_user then 'admin' else 'seller' end,
    first_user
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();
create trigger contacts_touch  before update on public.contacts  for each row execute function public.touch_updated_at();
create trigger deals_touch     before update on public.deals     for each row execute function public.touch_updated_at();

-- created_by / owner padrão = usuário atual
create or replace function public.set_creator()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then new.created_by = auth.uid(); end if;
  if to_jsonb(new) ? 'owner_id' and new.owner_id is null then new.owner_id = auth.uid(); end if;
  return new;
end;
$$;
create trigger companies_creator before insert on public.companies for each row execute function public.set_creator();
create trigger contacts_creator  before insert on public.contacts  for each row execute function public.set_creator();
create trigger deals_creator     before insert on public.deals     for each row execute function public.set_creator();

create or replace function public.set_activity_creator()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then new.created_by = auth.uid(); end if;
  if new.assigned_to is null then new.assigned_to = auth.uid(); end if;
  if new.done and new.done_at is null then new.done_at = now(); end if;
  if not new.done then new.done_at = null; end if;
  return new;
end;
$$;
create trigger activities_creator before insert or update on public.activities for each row execute function public.set_activity_creator();

-- =====================================================================
-- Motor de automações
-- =====================================================================
create or replace function public.render_template(tpl text, d public.deals, c public.contacts)
returns text language plpgsql as $$
begin
  tpl := coalesce(tpl, '');
  if d.id is not null then
    tpl := replace(tpl, '{{deal.title}}', coalesce(d.title, ''));
    tpl := replace(tpl, '{{deal.value}}', coalesce(d.value::text, '0'));
  end if;
  if c.id is not null then
    tpl := replace(tpl, '{{contact.name}}', coalesce(c.name, ''));
  end if;
  return tpl;
end;
$$;

create or replace function public.run_automation(a public.automations, d public.deals, c public.contacts)
returns void language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := a.action_config;
  assignee uuid;
  entity_name text := case when d.id is not null then 'deal' else 'contact' end;
  entity_id uuid := coalesce(d.id, c.id);
begin
  if a.action_type = 'create_activity' then
    assignee := case
      when cfg->>'assign' = 'creator' then coalesce(auth.uid(), d.owner_id, c.owner_id)
      when (cfg->>'assign') ~ '^[0-9a-f-]{36}$' then (cfg->>'assign')::uuid
      else coalesce(d.owner_id, c.owner_id, auth.uid())
    end;
    insert into public.activities (type, title, description, due_at, deal_id, contact_id, company_id, assigned_to, created_by)
    values (
      coalesce(cfg->>'type', 'task'),
      public.render_template(coalesce(cfg->>'title', a.name), d, c),
      public.render_template(cfg->>'description', d, c),
      now() + make_interval(days => coalesce((cfg->>'days_offset')::int, 1)),
      d.id,
      coalesce(d.contact_id, c.id),
      coalesce(d.company_id, c.company_id),
      assignee,
      coalesce(auth.uid(), assignee)
    );
  elsif a.action_type = 'set_deal_field' and d.id is not null then
    if cfg->>'field' = 'value' then
      update public.deals set value = (cfg->>'value')::numeric where id = d.id;
    elsif cfg->>'field' = 'expected_close_days' then
      update public.deals set expected_close = current_date + ((cfg->>'value')::int) where id = d.id;
    elsif cfg->>'field' = 'custom' then
      update public.deals set custom = custom || jsonb_build_object(cfg->>'key', cfg->'value') where id = d.id;
    end if;
  elsif a.action_type = 'add_tag' and c.id is not null then
    update public.contacts set tags = array_append(array_remove(tags, cfg->>'tag'), cfg->>'tag') where id = c.id;
  elsif a.action_type = 'add_tag' and d.contact_id is not null then
    update public.contacts set tags = array_append(array_remove(tags, cfg->>'tag'), cfg->>'tag') where id = d.contact_id;
  end if;
  insert into public.automation_runs (automation_id, entity, entity_id, ok, message)
  values (a.id, entity_name, entity_id, true, a.action_type);
exception when others then
  insert into public.automation_runs (automation_id, entity, entity_id, ok, message)
  values (a.id, entity_name, entity_id, false, sqlerrm);
end;
$$;

-- Sincroniza status/closed_at do negócio com o tipo da etapa (antes de gravar)
create or replace function public.deals_before_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st_kind text;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    select kind into st_kind from public.stages where id = new.stage_id;
    if st_kind <> 'open' then
      new.status := st_kind;
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.status := 'open';
      new.closed_at := null;
      new.lost_reason := null;
    end if;
    -- pipeline sempre coerente com a etapa
    select pipeline_id into new.pipeline_id from public.stages where id = new.stage_id;
  end if;
  return new;
end;
$$;
create trigger deals_sync_status
  before insert or update on public.deals
  for each row execute function public.deals_before_change();

-- Gatilhos em deals (histórico + automações)
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

  for a in select * from public.automations where active loop
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
create trigger deals_automations
  after insert or update of stage_id on public.deals
  for each row execute function public.deals_after_change();

-- Gatilhos em contatos
create or replace function public.contacts_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public.automations;
  d public.deals;
begin
  for a in select * from public.automations where active and trigger_type = 'contact_created' loop
    perform public.run_automation(a, d, new);
  end loop;
  return null;
end;
$$;
create trigger contacts_automations
  after insert on public.contacts
  for each row execute function public.contacts_after_insert();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles           enable row level security;
alter table public.org_settings       enable row level security;
alter table public.pipelines          enable row level security;
alter table public.stages             enable row level security;
alter table public.companies          enable row level security;
alter table public.contacts           enable row level security;
alter table public.deals              enable row level security;
alter table public.deal_stage_history enable row level security;
alter table public.activities         enable row level security;
alter table public.custom_fields      enable row level security;
alter table public.automations        enable row level security;
alter table public.automation_runs    enable row level security;

-- profiles: todos autenticados veem (para listar responsáveis); só o próprio ou admin edita
create policy "profiles_select" on public.profiles for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles p where p.id = auth.uid()) and active = (select active from public.profiles p where p.id = auth.uid()));
create policy "profiles_admin_all" on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- settings / pipelines / stages / custom_fields / automations: leitura para ativos, escrita para admin
create policy "settings_select" on public.org_settings for select to authenticated using (true);
create policy "settings_admin"  on public.org_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "pipelines_select" on public.pipelines for select to authenticated using (public.is_active_user());
create policy "pipelines_admin"  on public.pipelines for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "stages_select" on public.stages for select to authenticated using (public.is_active_user());
create policy "stages_admin"  on public.stages for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "custom_fields_select" on public.custom_fields for select to authenticated using (public.is_active_user());
create policy "custom_fields_admin"  on public.custom_fields for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "automations_select" on public.automations for select to authenticated using (public.is_active_user());
create policy "automations_admin"  on public.automations for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "automation_runs_select" on public.automation_runs for select to authenticated using (public.is_manager_or_admin());

-- companies / contacts / deals: acesso conforme visibilidade
create policy "companies_select" on public.companies for select to authenticated using (public.can_access(owner_id));
create policy "companies_insert" on public.companies for insert to authenticated with check (public.is_active_user());
create policy "companies_update" on public.companies for update to authenticated using (public.can_access(owner_id)) with check (public.can_access(owner_id));
create policy "companies_delete" on public.companies for delete to authenticated using (public.is_manager_or_admin() or owner_id = auth.uid());

create policy "contacts_select" on public.contacts for select to authenticated using (public.can_access(owner_id));
create policy "contacts_insert" on public.contacts for insert to authenticated with check (public.is_active_user());
create policy "contacts_update" on public.contacts for update to authenticated using (public.can_access(owner_id)) with check (public.can_access(owner_id));
create policy "contacts_delete" on public.contacts for delete to authenticated using (public.is_manager_or_admin() or owner_id = auth.uid());

create policy "deals_select" on public.deals for select to authenticated using (public.can_access(owner_id));
create policy "deals_insert" on public.deals for insert to authenticated with check (public.is_active_user());
create policy "deals_update" on public.deals for update to authenticated using (public.can_access(owner_id)) with check (public.can_access(owner_id));
create policy "deals_delete" on public.deals for delete to authenticated using (public.is_manager_or_admin() or owner_id = auth.uid());

create policy "history_select" on public.deal_stage_history for select to authenticated using (public.is_active_user());

-- activities: quem é responsável, criador, ou gestor/admin (ou visibilidade 'all')
create policy "activities_select" on public.activities for select to authenticated
  using (public.is_active_user() and (public.is_manager_or_admin() or assigned_to = auth.uid() or created_by = auth.uid()
         or (select seller_visibility from public.org_settings where id = 1) = 'all'));
create policy "activities_insert" on public.activities for insert to authenticated with check (public.is_active_user());
create policy "activities_update" on public.activities for update to authenticated
  using (public.is_active_user() and (public.is_manager_or_admin() or assigned_to = auth.uid() or created_by = auth.uid()
         or (select seller_visibility from public.org_settings where id = 1) = 'all'));
create policy "activities_delete" on public.activities for delete to authenticated
  using (public.is_manager_or_admin() or created_by = auth.uid() or assigned_to = auth.uid());

-- =====================================================================
-- Dados iniciais: funil padrão e campos de exemplo
-- =====================================================================
insert into public.pipelines (id, name, position, is_default)
values ('00000000-0000-0000-0000-000000000001', 'Funil de Vendas', 0, true);

insert into public.stages (pipeline_id, name, position, color, probability, kind) values
  ('00000000-0000-0000-0000-000000000001', 'Novo lead',       0, '#babec6', 10,  'open'),
  ('00000000-0000-0000-0000-000000000001', 'Contato feito',   1, '#818a66', 25,  'open'),
  ('00000000-0000-0000-0000-000000000001', 'Qualificado',     2, '#6f8a5a', 45,  'open'),
  ('00000000-0000-0000-0000-000000000001', 'Proposta enviada',3, '#c9973f', 65,  'open'),
  ('00000000-0000-0000-0000-000000000001', 'Negociação',      4, '#ab6f30', 80,  'open'),
  ('00000000-0000-0000-0000-000000000001', 'Ganho',           5, '#2e381a', 100, 'won'),
  ('00000000-0000-0000-0000-000000000001', 'Perdido',         6, '#a8432f', 0,   'lost');

insert into public.custom_fields (entity, key, label, type, options, position) values
  ('contact', 'origem_detalhe', 'Detalhe da origem', 'text', '[]', 0),
  ('contact', 'interesse', 'Interesse principal', 'select', '["Mentoria","Consultoria","Curso","Outro"]', 1),
  ('deal',    'produto', 'Produto/Serviço', 'select', '["Mentoria","Consultoria","Curso"]', 0),
  ('deal',    'forma_pagamento', 'Forma de pagamento', 'select', '["À vista","Parcelado","Recorrente"]', 1);

insert into public.automations (name, trigger_type, trigger_config, action_type, action_config) values
  ('Follow-up de novo negócio', 'deal_created', '{}',
   'create_activity', '{"type":"call","title":"Primeiro contato: {{deal.title}}","days_offset":1,"assign":"owner"}'),
  ('Lembrete após proposta', 'deal_stage_changed', '{}',
   'create_activity', '{"type":"task","title":"Acompanhar {{deal.title}}","days_offset":2,"assign":"owner"}');

-- A segunda automação deve disparar apenas na etapa "Proposta enviada"
update public.automations
set trigger_config = jsonb_build_object('stage_id', (select id from public.stages where name = 'Proposta enviada' limit 1))
where name = 'Lembrete após proposta';
