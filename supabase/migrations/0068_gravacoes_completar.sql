-- Completa o link da gravação das sessões registradas antes de o Google processar o vídeo (a cada 30 minutos)
select cron.unschedule('crm-gravacoes-completar') where exists (select 1 from cron.job where jobname = 'crm-gravacoes-completar');
select cron.schedule('crm-gravacoes-completar', '7,37 * * * *', $$
  select net.http_post(
    url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/gravacoes-completar',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
