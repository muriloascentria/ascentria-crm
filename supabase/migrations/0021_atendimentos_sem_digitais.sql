-- Fechamento da qualificação: "com seus atendimentos digitais." passa a "com seus atendimentos."
update public.quick_replies
set body = replace(body, 'com seus atendimentos digitais.', 'com seus atendimentos.')
where stage = 'qualificacao' and title = 'Fechamento da qualificação';
