-- Funil Mentoria: nova coluna "Desqualificado" (depois de Perdido apresentado) e "Perdido" passa a se chamar "Não compareceu".
update public.stages set position = position + 1
 where pipeline_id = '00000000-0000-0000-0000-000000000002' and position >= 12
   and not exists (select 1 from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and name = 'Desqualificado');
insert into public.stages (pipeline_id, name, position, color, probability, kind, role, wa_template_lang, auto_send)
select '00000000-0000-0000-0000-000000000002', 'Desqualificado', 12, '#8a7a96', 0, 'open', 'archived', 'pt_BR', false
 where not exists (select 1 from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and name = 'Desqualificado');
update public.stages set name = 'Não compareceu' where id = '2616a966-767c-4a38-a9ce-4133a4ae51a7';
