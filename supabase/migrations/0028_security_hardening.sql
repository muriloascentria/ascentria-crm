-- Endurecimento de segurança (auditoria de 27/09/2026)

-- 1) Visitante não autenticado (anon) não tem nenhum acesso direto às tabelas e funções do CRM.
--    (As políticas RLS já bloqueavam; aqui tiramos também as permissões de base: defesa em profundidade.)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

-- O usuário logado continua com o que o app usa: funções das políticas + as duas chamadas do painel.
grant execute on function public.is_active_user(), public.is_admin(), public.is_manager_or_admin(), public.can_access(uuid),
  public.sent_last_24h(), public.move_inbox_to_day1(uuid, integer) to authenticated;
-- Funções internas (usadas só por gatilhos e rotinas do servidor) saem da API.
revoke execute on function public.default_wa_number(), public.entry_pipeline(), public.entry_stage(uuid), public.first_day_stage(uuid),
  public.extract_br_phone(text), public.normalize_phone(text), public.render_message(text, public.contacts),
  public.render_template(text, public.deals, public.contacts), public.lead_first_name(public.contacts), public.in_wa_window(public.deals)
  from authenticated;

-- 2) Perfis: quem se cadastrou e ainda não foi aprovado vê só o próprio perfil (antes via e-mails de toda a equipe).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());

-- 3) Fila e histórico do WhatsApp: só o servidor grava (antes, qualquer usuário ativo podia enfileirar envios).
drop policy if exists wa_outbox_insert on public.wa_outbox;
drop policy if exists wa_outbox_select on public.wa_outbox;
drop policy if exists wa_outbox_admin on public.wa_outbox;
create policy wa_outbox_select on public.wa_outbox for select to authenticated using (public.is_manager_or_admin());
create policy wa_outbox_admin on public.wa_outbox for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists wa_messages_insert on public.wa_messages;

-- 4) Disparo em lote (Recebidos → Dia 1) gera envios pagos: só gestor ou administrador.
create or replace function public.move_inbox_to_day1(p_pipeline uuid, p_count integer)
returns integer language plpgsql security definer set search_path = public as $function$
declare
  n int := 0;
  inbox uuid := public.entry_stage(p_pipeline);
  day1 uuid := public.first_day_stage(p_pipeline);
begin
  if not public.is_manager_or_admin() then raise exception 'Apenas gestores ou administradores podem mover em lote'; end if;
  if inbox is null or day1 is null then return 0; end if;
  with sel as (
    select id from public.deals where stage_id = inbox and status = 'open'
    order by created_at limit least(greatest(p_count, 0), 500)
  )
  update public.deals d set stage_id = day1 from sel where d.id = sel.id;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- 5) Registro de auditoria: quem apagou/alterou dados sensíveis e configurações. Só administradores leem; ninguém edita.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  actor_email text,
  table_name text not null,
  op text not null,
  row_id text,
  old_data jsonb,
  new_data jsonb
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
create policy audit_log_admin_select on public.audit_log for select to authenticated using (public.is_admin());

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $function$
begin
  -- ignora os carimbos automáticos do webhook em org_settings
  if tg_table_name = 'org_settings' and tg_op = 'UPDATE'
     and (to_jsonb(new) - 'wa_last_event_at' - 'wa_connected' - 'updated_at') = (to_jsonb(old) - 'wa_last_event_at' - 'wa_connected' - 'updated_at') then
    return null;
  end if;
  insert into public.audit_log (actor_email, table_name, op, row_id, old_data, new_data)
  values ((select email from public.profiles where id = auth.uid()), tg_table_name, tg_op,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', ''),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return null;
end;
$function$;
revoke execute on function public.audit_trigger() from public, anon, authenticated;

do $$
declare t text;
begin
  -- exclusões de dados de clientes
  foreach t in array array['contacts', 'deals', 'activities', 'wa_messages'] loop
    execute format('drop trigger if exists audit_delete on public.%I', t);
    execute format('create trigger audit_delete after delete on public.%I for each row execute function public.audit_trigger()', t);
  end loop;
  -- qualquer alteração em acessos e configurações
  foreach t in array array['profiles', 'wa_numbers', 'pipelines', 'stages', 'org_settings', 'automations', 'quick_replies'] loop
    execute format('drop trigger if exists audit_all on public.%I', t);
    execute format('create trigger audit_all after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- 6) Segredo do agendador (cron) guardado no Vault e trocado por um novo aleatório.
--    O valor antigo (que apareceu em uma captura de tela) deixa de funcionar.
do $$
begin
  if exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'cron_secret'), encode(extensions.gen_random_bytes(32), 'hex'));
  else
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'Autoriza o pg_cron a chamar a função cadence-run');
  end if;
end $$;

create or replace function public.check_cron_secret(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(p) >= 32 and p = (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'), false)
$$;
revoke execute on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'crm-cadence-hourly'),
  command := $cmd$
  select net.http_post(
    url     := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/cadence-run',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb
  );
  $cmd$
);
