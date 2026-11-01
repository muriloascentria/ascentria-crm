-- Termo de cancelamento (distrato) da mentoria: documento no Drive + envio para assinatura pela Autentique
alter table public.deals
  add column if not exists distrato_doc_id text,
  add column if not exists distrato_url text,
  add column if not exists distrato_status text,          -- pronto | enviado | assinado | recusado
  add column if not exists distrato_autentique_id text,
  add column if not exists distrato_enviado_em timestamptz,
  add column if not exists distrato_assinaturas jsonb,
  add column if not exists distrato_assinado_em timestamptz,
  add column if not exists distrato_pdf_url text;
