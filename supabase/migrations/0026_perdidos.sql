-- A coluna "Arquivado" vira três colunas de perdido, todas com a mesma regra de retorno
-- (função 'archived': ficam N meses — archive_months, hoje 4 — e voltam ao Dia 1 da cadência):
--   * Perdido cadência     — passou do Dia 1 ao Dia 5 sem interagir (o motor da cadência coloca aqui:
--                             é a primeira coluna 'archived' do funil)
--   * Perdido desinteresse — estava na cadência e disse que não quer a consultoria gratuita (manual)
--   * Perdido apresentado  — participou do encontro, mas não fechou (manual)
do $$
declare
  p record;
  arch public.stages;
begin
  for p in select distinct pipeline_id from public.stages where role = 'archived' loop
    select * into arch from public.stages where pipeline_id = p.pipeline_id and role = 'archived' order by position limit 1;
    update public.stages set name = 'Perdido cadência', color = '#cfc9b6' where id = arch.id;
    update public.stages set position = position + 2 where pipeline_id = p.pipeline_id and position > arch.position;
    insert into public.stages (pipeline_id, name, position, color, probability, kind, role, wa_template_lang, auto_send)
    values (p.pipeline_id, 'Perdido desinteresse', arch.position + 1, '#c9a27e', 0, 'open', 'archived', 'pt_BR', false),
           (p.pipeline_id, 'Perdido apresentado',  arch.position + 2, '#b98a6a', 0, 'open', 'archived', 'pt_BR', false);
  end loop;
end $$;
