-- Nas mensagens prontas, "Consultório Digital" vira sempre "Consultório de Enfermagem"
-- (sem repetir quando o texto já dizia "Consultório Digital de Enfermagem").
update public.quick_replies
set body = regexp_replace(body, '(onsult[óo]rio) [Dd]igital( de Enfermagem)?', '\1 de Enfermagem', 'g')
where body ~* 'consult[óo]rio digital';
