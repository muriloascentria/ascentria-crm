-- Confere na Autentique, a cada 3 minutos, os contratos enviados para assinatura (reserva do webhook):
-- assim que o lead assina, o card é atualizado e o aviso verde "O lead assinou o contrato" aparece no CRM.
select cron.unschedule('crm-contrato-acompanhar') where exists (select 1 from cron.job where jobname = 'crm-contrato-acompanhar');
select cron.schedule('crm-contrato-acompanhar', '*/3 * * * *', $$
  select net.http_post(
    url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/contrato-run',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
