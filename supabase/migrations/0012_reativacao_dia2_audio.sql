-- Reativação / Dia 2: mesma mensagem do áudio da Mentoria. Reaproveita o modelo já existente
-- mentoria_dia_2 (sem variável), então não é preciso criar reativacao_dia_2 na Meta.
update public.stages
   set message_text = 'Poderia ouvir o áudio que enviei?', wa_template_name = 'mentoria_dia_2', wa_template_lang = 'pt_BR'
 where pipeline_id = '00000000-0000-0000-0000-000000000003' and role = 'day' and name = 'Dia 2';
