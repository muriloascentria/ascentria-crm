-- Lembrete de 4h fora da janela usa o modelo lembrete_consultoria ({{1}} nome, {{2}} hoje/amanhã, {{3}} hora).
-- "approved" começa falso; o motor (cadence-run) confere o status na Meta e liga sozinho quando aprovar.
-- (A função queue_meeting_reminders foi recriada com essa checagem; ver o banco para a versão completa.)
update public.org_settings
   set reminder_templates = jsonb_build_object('4h', jsonb_build_object('name', 'lembrete_consultoria', 'lang', 'pt_BR', 'params', jsonb_build_array('primeiro_nome', 'quando', 'hora'), 'approved', false))
 where id = 1;
