-- Gravação, transcrição e anotações da reunião de venda (Google Meet).
-- O Google anexa esses arquivos ao evento da agenda da vendedora; a função "calendar" (ação "files")
-- lê os anexos do evento e guarda os links aqui, para aparecerem no card do lead.
alter table public.deals add column if not exists meeting_files jsonb not null default '[]'::jsonb;
alter table public.deals add column if not exists meeting_files_checked_at timestamptz;
