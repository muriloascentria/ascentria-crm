-- Retrato dos modelos de mensagem da conta na Meta (nome, status, categoria, motivo de rejeição),
-- atualizado pelo motor da cadência. Serve para conferir a aprovação sem abrir o Gerenciador do WhatsApp.
alter table public.org_settings add column if not exists wa_templates jsonb not null default '[]'::jsonb;
alter table public.org_settings add column if not exists wa_templates_checked_at timestamptz;
