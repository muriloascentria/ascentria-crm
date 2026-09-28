-- Aviso de mensagem nova: o card fica marcado quando o lead responde e alguém da equipe ainda não abriu.
alter table public.deals add column if not exists seen_at timestamptz;

-- Respostas antigas (antes dos primeiros envios em massa de 28/09, 18h40) começam como "vistas";
-- quem respondeu depois disso já aparece com a bolinha.
update public.deals set seen_at = now()
 where last_inbound_at is not null and seen_at is null and last_inbound_at < timestamptz '2026-09-28 21:40:00+00';

-- Quantos negócios têm resposta não lida (respeita as regras de acesso de quem pergunta).
create or replace function public.unread_deals_count()
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.deals
   where status = 'open' and last_inbound_at is not null
     and last_inbound_at > coalesce(seen_at, '-infinity'::timestamptz)
$$;
revoke execute on function public.unread_deals_count() from public, anon;
grant execute on function public.unread_deals_count() to authenticated;
