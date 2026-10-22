-- Relatório da consultoria gratuita gerado sozinho (função relatorio-run, a cada 10 min pelo pg_cron)
alter table public.deals
  add column if not exists relatorio_texto text,
  add column if not exists relatorio_pronto_em timestamptz,
  add column if not exists relatorio_enviado_em timestamptz,
  add column if not exists relatorio_checado_em timestamptz,
  add column if not exists relatorio_erro text,
  add column if not exists relatorio_doc_url text;
create index if not exists deals_relatorio_pendente on public.deals (relatorio_pronto_em) where relatorio_pronto_em is not null and relatorio_enviado_em is null;
-- select cron.schedule('crm-relatorio-consultoria', '*/10 * * * *', $$ select net.http_post(url := '.../functions/v1/relatorio-run', headers := ... cron_secret ..., body := '{}'::jsonb, timeout_milliseconds := 120000) $$);
