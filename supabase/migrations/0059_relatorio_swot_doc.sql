-- Relatório de Diagnóstico (SWOT) no papel timbrado da Ascentria.
-- A tarefa agendada escreve deals.relatorio_swot; a função relatorio-run copia o modelo
-- (org_settings.relatorio_template_id), preenche e grava relatorio_doc_id / relatorio_doc_link.
alter table public.deals
  add column if not exists relatorio_swot jsonb,
  add column if not exists relatorio_doc_id text,
  add column if not exists relatorio_doc_link text;
alter table public.org_settings
  add column if not exists relatorio_template_id text,
  add column if not exists relatorio_folder_id text;
