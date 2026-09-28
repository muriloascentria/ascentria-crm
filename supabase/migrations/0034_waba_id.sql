-- Guarda o ID da conta do WhatsApp (WABA) para o botão "Verificar e conectar" já vir preenchido.
alter table public.org_settings add column if not exists wa_waba_id text;
update public.org_settings set wa_waba_id = '1797081027991140' where id = 1 and wa_waba_id is null;
