-- =====================================================================
-- Agendamento do motor da cadência (rode DEPOIS de publicar as Edge Functions)
-- Substitua <SEU-PROJETO> e <CRON_SECRET> antes de executar.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- roda de hora em hora; run_cadence() só avança quem já cumpriu o prazo da coluna
select cron.schedule(
  'crm-cadence-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://<SEU-PROJETO>.supabase.co/functions/v1/cadence-run',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <CRON_SECRET>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- para conferir / remover:
--   select * from cron.job;
--   select cron.unschedule('crm-cadence-hourly');
