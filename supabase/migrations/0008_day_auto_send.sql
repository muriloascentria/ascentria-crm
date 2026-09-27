-- Dia 1 a Dia 5 do funil de Mentoria enviam a mensagem automaticamente pelo WhatsApp
-- (template aprovado), em vez de criar tarefa para envio manual.
update public.stages
   set auto_send = true
 where pipeline_id = '00000000-0000-0000-0000-000000000002'
   and role = 'day';
