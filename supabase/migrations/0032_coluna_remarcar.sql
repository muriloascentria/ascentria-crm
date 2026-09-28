-- Coluna "Remarcar" logo depois de "Reunião agendada" (quem cancelou o encontro), sem mensagem automática.
do $$
declare p record; ref public.stages;
begin
  for p in select distinct pipeline_id from public.stages where name = 'Reunião agendada' loop
    if exists (select 1 from public.stages where pipeline_id = p.pipeline_id and name = 'Remarcar') then continue; end if;
    select * into ref from public.stages where pipeline_id = p.pipeline_id and name = 'Reunião agendada';
    update public.stages set position = position + 1 where pipeline_id = p.pipeline_id and position > ref.position;
    insert into public.stages (pipeline_id, name, position, color, probability, kind, role, wa_template_lang, auto_send)
    values (p.pipeline_id, 'Remarcar', ref.position + 1, '#c9973f', 40, 'open', null, 'pt_BR', false);
  end loop;
end $$;
