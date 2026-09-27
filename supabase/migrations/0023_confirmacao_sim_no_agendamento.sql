-- A sequência que pede o SIM vai logo depois de "Horário escolhido", ainda no Agendamento.
-- Depois do SIM vem a Qualificação.
update public.quick_replies
set stage = 'agendamento', position = 102
where stage = 'confirmacao' and title = 'Importância e confirmação (SIM)';
