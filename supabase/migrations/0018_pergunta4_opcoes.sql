-- Pergunta 4 (renda): entra a opção "Ganho o piso". Com 4 opções o lead recebe uma lista
-- (limite de 24 letras por opção), por isso "Sem renda na Enfermagem" cabe inteira.
update public.quick_replies
set options = array['Mais que o piso','Ganho o piso','Menos que o piso','Sem renda na Enfermagem']
where stage = 'qualificacao' and title = 'Pergunta 4 (renda na Enfermagem)';
