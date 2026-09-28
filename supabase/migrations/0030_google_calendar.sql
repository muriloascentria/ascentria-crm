-- Agenda Google das vendedoras: o CRM busca os blocos "DISPONÍVEL PARA AGENDAMENTO", preenche os dois horários
-- da mensagem pronta e, quando o lead escolhe, reserva o bloco (renomeia + cria o Google Meet).

create table if not exists public.calendar_sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,          -- e-mail @ascentria.com.br da vendedora (a agenda principal dela)
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.calendar_sellers enable row level security;
revoke all on public.calendar_sellers from anon;
create policy calendar_sellers_select on public.calendar_sellers for select to authenticated using (public.is_active_user());
create policy calendar_sellers_admin on public.calendar_sellers for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop trigger if exists audit_all on public.calendar_sellers;
create trigger audit_all after insert or update or delete on public.calendar_sellers for each row execute function public.audit_trigger();

alter table public.deals
  add column if not exists seller_id uuid references public.calendar_sellers(id) on delete set null,
  add column if not exists calendar_event_id text,
  add column if not exists offered_slots jsonb not null default '[]'::jsonb;

alter table public.org_settings
  add column if not exists slot_title text not null default 'DISPONÍVEL PARA AGENDAMENTO';
