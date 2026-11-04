-- Partes anteriores da consultoria (reunião que começou e foi remarcada): o evento fica na agenda com a gravação
-- e entra aqui, para o CRM juntar os arquivos do Meet de todas as partes no card.
alter table public.deals add column if not exists reunioes_anteriores jsonb not null default '[]'::jsonb;
