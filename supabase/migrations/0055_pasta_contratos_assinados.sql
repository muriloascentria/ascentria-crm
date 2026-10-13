-- Contratos assinados pelo eCRM vão (em PDF) para a pasta do Drive da empresa:
-- Ascentria › Contratos_Termos_Declarações_Manuais › Contratos › Contratos_Assinados › Mentoria_Essência
alter table public.org_settings add column if not exists contract_signed_folder_id text default '1bcmniYlQp_PQhMloHEXXoWZMsejpjM2T';
update public.org_settings set contract_signed_folder_id = '1bcmniYlQp_PQhMloHEXXoWZMsejpjM2T' where id = 1 and contract_signed_folder_id is null;
-- arquivo do contrato assinado nessa pasta (evita mandar duas vezes)
alter table public.deals add column if not exists contrato_arquivo_id text;
alter table public.deals add column if not exists contrato_arquivo_url text;
