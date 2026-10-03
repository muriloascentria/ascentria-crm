-- Remove o funil "Reativação" (vazio desde a 0048; a reativação automática está desligada).
-- As etapas dele saem junto (cascade). Só apaga se não houver nenhum card no funil.
update public.pipelines set reactivate_to_pipeline_id = null
 where reactivate_to_pipeline_id = '00000000-0000-0000-0000-000000000003';
delete from public.pipelines
 where id = '00000000-0000-0000-0000-000000000003'
   and not exists (select 1 from public.deals where pipeline_id = '00000000-0000-0000-0000-000000000003');
