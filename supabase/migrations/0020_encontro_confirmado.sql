-- Encontro confirmado com o lead: dia, hora e link da videochamada ficam no negócio.
-- O painel de conversa usa esses dados para preencher [DATA], [HORA], [HOJE OU AMANHÃ] e [LINK]
-- nas mensagens prontas, sem a consultora precisar digitar em cada uma.
alter table public.deals add column if not exists meeting_date date;
alter table public.deals add column if not exists meeting_time time;
alter table public.deals add column if not exists meeting_link text;

-- "Horário escolhido" usava [DIA]; passa a usar [DATA], como as demais.
update public.quick_replies set body = replace(body, '[DIA] às [HORA]', '[DATA] às [HORA]')
where stage = 'agendamento' and title = 'Horário escolhido';
