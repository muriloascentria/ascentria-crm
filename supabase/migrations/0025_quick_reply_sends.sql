-- Registro de quais mensagens prontas já foram enviadas para cada contato. O painel de conversa
-- mostra um ✓ nas enviadas e destaca a próxima, para quem envia não se perder na sequência.
create table if not exists public.quick_reply_sends (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  quick_reply_id  uuid not null references public.quick_replies(id) on delete cascade,
  deal_id         uuid references public.deals(id) on delete set null,
  sent_by         uuid references public.profiles(id) on delete set null default auth.uid(),
  sent_at         timestamptz not null default now()
);
create index if not exists quick_reply_sends_contact_idx on public.quick_reply_sends (contact_id);

alter table public.quick_reply_sends enable row level security;
create policy "quick_reply_sends_select" on public.quick_reply_sends for select to authenticated using (public.is_active_user());
create policy "quick_reply_sends_insert" on public.quick_reply_sends for insert to authenticated with check (public.is_active_user());
create policy "quick_reply_sends_delete" on public.quick_reply_sends for delete to authenticated using (public.is_active_user());
