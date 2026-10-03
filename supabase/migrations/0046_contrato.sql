-- Contrato da Mentoria Essência gerado pelo card do lead.
-- A função "contrato" copia o modelo (Google Docs) para o Drive da vendedora, preenche os dados do lead
-- e devolve o link. A vendedora pede as assinaturas pelo Google Assinaturas (Murilo + lead).
alter table public.deals add column if not exists contrato jsonb;                 -- dados preenchidos no formulário
alter table public.deals add column if not exists contrato_doc_id text;           -- id do documento no Google Drive
alter table public.deals add column if not exists contrato_url text;
alter table public.deals add column if not exists contrato_status text;           -- 'gerado' | 'assinado'
alter table public.deals add column if not exists contrato_gerado_em timestamptz;
alter table public.deals add column if not exists contrato_assinado_em timestamptz;

-- modelo do contrato e e-mail de quem assina pelo CONTRATADO
alter table public.org_settings add column if not exists contract_template_id text default '1Cf64cjeT0q8T0-mzzz0DPbsbFZGcfgrKE0dfcU2gwPg';
alter table public.org_settings add column if not exists contract_signer_email text default 'murilo@ascentria.com.br';
update public.org_settings set
  contract_template_id = coalesce(contract_template_id, '1Cf64cjeT0q8T0-mzzz0DPbsbFZGcfgrKE0dfcU2gwPg'),
  contract_signer_email = coalesce(contract_signer_email, 'murilo@ascentria.com.br')
where id = 1;
