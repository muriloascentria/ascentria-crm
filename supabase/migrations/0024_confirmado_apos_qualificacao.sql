-- "Confirmado! ... lembretes ... dica" vai no fim da Qualificação, depois do Fechamento.
update public.quick_replies
set stage = 'qualificacao', position = 205, title = 'Confirmado (lembretes e dica)'
where stage = 'confirmacao' and title = 'Depois do SIM';
