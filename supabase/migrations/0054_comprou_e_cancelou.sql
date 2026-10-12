-- Funil Mentoria: coluna "Comprou e cancelou" logo depois de "Fechou mentoria" (fecha o card como perdido).
update public.stages set position = position + 1
 where pipeline_id = '00000000-0000-0000-0000-000000000002' and position >= 14
   and not exists (select 1 from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and name = 'Comprou e cancelou');
insert into public.stages (pipeline_id, name, position, color, probability, kind, role, wa_template_lang, auto_send)
select '00000000-0000-0000-0000-000000000002', 'Comprou e cancelou', 14, '#7a4a3a', 0, 'lost', null, 'pt_BR', false
 where not exists (select 1 from public.stages where pipeline_id = '00000000-0000-0000-0000-000000000002' and name = 'Comprou e cancelou');
