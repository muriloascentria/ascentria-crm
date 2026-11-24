-- Régua de cobrança do funil "Inadimplentes" (pedido do Murilo em 24/11/2026): a função cobranca-run lê o
-- financeiro do ePLAT às 8h31 (D-2, D0 e quem pagou → Regularizado) e às 14h31 (quem não pagou → 1º lembrete D+1).
create or replace function public.contato_por_fone(p text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.contacts
   where length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 8
     and right(regexp_replace(coalesce(phone, wa_id, ''), '\D', '', 'g'), 8) = right(regexp_replace(p, '\D', '', 'g'), 8)
   order by created_at limit 1;
$$;
revoke all on function public.contato_por_fone(text) from public, anon, authenticated;

select cron.unschedule(j) from unnest(array['crm-cobranca-manha','crm-cobranca-tarde']) j where exists (select 1 from cron.job where jobname = j);
select cron.schedule('crm-cobranca-manha', '31 11 * * *', $$
  select net.http_post(
    url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/cobranca-run',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
select cron.schedule('crm-cobranca-tarde', '31 17 * * *', $$
  select net.http_post(
    url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/cobranca-run',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
