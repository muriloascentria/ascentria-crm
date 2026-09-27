-- =====================================================================
-- Mensagens prontas por etapa (Agendamento, Qualificação, Confirmação)
--  stage nulo       → aparece em "Outras"
--  body com linhas  "---" separa mensagens que saem em sequência, uma
--  depois da outra, com um clique. As opções (se houver) vão na última.
--  Textos entre colchetes, como [DATA], são preenchidos por quem envia;
--  o painel não deixa enviar enquanto sobrar algum.
-- =====================================================================
alter table public.quick_replies add column if not exists stage text;
alter table public.quick_replies drop constraint if exists quick_replies_stage_check;
alter table public.quick_replies add constraint quick_replies_stage_check
  check (stage is null or stage in ('agendamento','qualificacao','confirmacao'));

insert into public.quick_replies (stage, title, body, options, position) values
-- ------------------------------ AGENDAMENTO ------------------------------
('agendamento', 'Primeiro contato: dois horários',
'Olá, {{primeiro_nome}}!
---
Aqui é a Mari, do time do Enfermeiro Murilo. Tudo bem?
---
Ele me pediu para agendar um horário com você, para te entregar uma sessão de Consultoria gratuita sobre Consultório Digital de Enfermagem.
---
Temos disponibilidade *[DIA 1] às [HORA 1]* ou *[DIA 2] às [HORA 2]* (horário de Brasília). Qual fica melhor para você?',
'{}', 100),
('agendamento', 'Horário escolhido',
'Perfeito, {{primeiro_nome}}! Horário reservado: *[DIA] às [HORA]* (horário de Brasília).',
'{}', 101),
-- ------------------------------ QUALIFICAÇÃO -----------------------------
('qualificacao', 'Abertura + Pergunta 1 (quem participa)',
'{{primeiro_nome}}, para entender se conseguimos realmente te ajudar a estruturar seu consultório digital de Enfermagem, preciso te fazer 4 perguntas rápidas:
---
*1) A sessão de Consultoria gratuita é praticamente uma aula sobre Consultório de Enfermagem, onde vamos entregar o nosso melhor para você. Diante disso, existe mais alguém que você acha que deveria estar junto conosco na sessão?*',
array['Sim, esposa(o)','Sim, sócio(a)','Sim, pessoa da família','Não'], 200),
('qualificacao', 'Pergunta 2 (importância de 1 a 10)',
'*2) De 1 a 10, qual é a importância de estruturar um consultório digital de Enfermagem que fature pelo menos R$ 15 mil por mês?*',
array['1','2','3','4','5','6','7','8','9','10'], 201),
('qualificacao', 'Pergunta 3 (quando pretende começar)',
'*3) Quando você pretende começar a estruturar seu consultório digital?*',
array['O quanto antes','Entre 3 e 6 meses','Daqui a 12 meses'], 202),
('qualificacao', 'Pergunta 4 (renda na Enfermagem)',
'*4) Quanto você ganha por mês com seu trabalho na Enfermagem?* (O piso salarial hoje é R$ 4.750,00.)',
array['Menos que o piso','Mais que o piso','Não tenho renda'], 203),
('qualificacao', 'Fechamento da qualificação',
'Já registramos na nossa agenda o tempo que vamos passar com você. Nossa agenda é bem disputada, e por isso estamos te passando esta confirmação.

No nosso tempo juntos, vamos mostrar como você pode estruturar seu Consultório Digital de Enfermagem e faturar pelo menos R$ 15.000,00 por mês com seus atendimentos digitais.

Então, confirmando: *dia [DATA] às [HORA]* (horário de Brasília).',
'{}', 204),
-- ------------------------------ CONFIRMAÇÃO ------------------------------
('confirmacao', 'Importância e confirmação (SIM)',
'Enf. {{primeiro_nome}}, por aqui vou enviar os lembretes e o link da nossa videochamada.
---
Atender você e outros enfermeiros em videochamada é o nosso trabalho, e fazemos isso com muita dedicação. É uma profissão que levamos a sério.
---
Por outro lado, tempo é dinheiro, e tanto o seu tempo quanto o nosso são muito valiosos.
---
Outros enfermeiros também pediram essa consultoria. Reservar este horário para você significa não poder oferecê-lo a outra pessoa. Se você não comparecer, nem você nem esses profissionais serão atendidos.
---
Por isso, podemos confirmar a nossa videochamada no dia *[DATA] às [HORA]* (horário de Brasília)?
Digite *SIM* se estiver confirmado 👇🏻',
'{}', 300),
('confirmacao', 'Depois do SIM',
'Confirmado, {{primeiro_nome}}! 🙌🏻
---
Antes do nosso encontro eu te mando os lembretes por aqui, e o link da videochamada chega nesta conversa 15 minutos antes do horário.
---
Uma dica: esteja num lugar tranquilo, com fone de ouvido, papel e caneta. Vale muito a pena anotar.',
'{}', 301),
('confirmacao', 'Lembrete 4h antes (ou na véspera, se for de manhã)',
'Olá, {{primeiro_nome}}, tudo bem por aí?
Estamos te deixando aqui o nosso Instagram https://www.instagram.com/enfermeiromurilo/ e YouTube: https://www.youtube.com/@enfermeiromurilo caso você queira dar uma olhada antes da nossa videochamada [HOJE OU AMANHÃ] às *[HORA]* no Google Meet.

[HOJE OU AMANHÃ], antes do horário da nossa videochamada às *[HORA]*, vamos te mandar o link do Google Meet.
---
Você estará presente e disponível para focar nesse tempo que estaremos juntos?',
'{}', 302),
('confirmacao', 'Lembrete 1h antes',
'*ESTÁ QUASE NA HORA!*
Tudo certo para, daqui a 1 hora, você ter acesso a como estruturar seu Consultório Digital de Enfermagem? Alguns minutos antes já vamos te mandar o link do Google Meet.

Lembre que é importante que você esteja presente e focado, porque vamos analisar o seu momento atual na Enfermagem e te mostrar o caminho para estruturar o seu Consultório Digital.

Te vemos já já!',
'{}', 303),
('confirmacao', 'Envio do link (15 min antes)',
'Olá, {{primeiro_nome}}
---
Segue link conforme combinado.
---
[LINK]',
'{}', 304),
('confirmacao', 'Não confirmou o SIM',
'{{primeiro_nome}}, ainda preciso da sua confirmação para manter o horário de *[DATA] às [HORA]*.
---
Se não for possível, sem problema: me avisa que eu libero a vaga para outro enfermeiro e remarcamos para você.',
'{}', 305);
