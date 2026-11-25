-- Baixa no ePLAT reflete no CRM em até 5 minutos (pedido do Murilo em 25/11/2026): a régua roda a cada 5 min, das 7h às 21h.
select cron.unschedule(j) from unnest(array['crm-cobranca-manha','crm-cobranca-tarde','crm-cobranca']) j where exists (select 1 from cron.job where jobname = j);
select cron.schedule('crm-cobranca', '*/5 10-23,0 * * *', $$
  select net.http_post(
    url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/cobranca-run',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
