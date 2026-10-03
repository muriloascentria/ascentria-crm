-- Contrato enviado para assinatura pela Autentique (Murilo + lead, por e-mail).
-- A Autentique avisa o CRM (função autentique-webhook) a cada assinatura; quando todos assinam,
-- o card fica "assinado" e o PDF assinado vai para o registro da sessão e para o Plat.
alter table public.deals add column if not exists contrato_autentique_id text;
alter table public.deals add column if not exists contrato_assinaturas jsonb;   -- [{nome, email, assinado_em, recusado_em, visto_em}]
alter table public.deals add column if not exists contrato_pdf_url text;         -- PDF assinado (Autentique)
create index if not exists deals_contrato_autentique_idx on public.deals (contrato_autentique_id) where contrato_autentique_id is not null;
