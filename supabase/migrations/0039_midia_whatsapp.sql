-- Áudios, fotos, vídeos e documentos enviados pelos leads no WhatsApp.
-- A Meta só guarda o arquivo por um tempo e exige o token para baixar; a função wa-media
-- baixa uma vez, guarda numa pasta privada e devolve um link temporário para tocar/abrir no CRM.
alter table public.wa_messages add column if not exists media_path text;
alter table public.wa_messages add column if not exists media_mime text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-media', 'wa-media', false, 104857600)
on conflict (id) do nothing;
