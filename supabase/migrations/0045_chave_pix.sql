-- Chave Pix da empresa: botão "Chave Pix" no painel de conversa coloca a chave na caixa de mensagem.
-- Editável em Configurações → Mensagens prontas.
alter table public.org_settings add column if not exists pix_key text default '59424703000190';
update public.org_settings set pix_key = '59424703000190' where id = 1 and pix_key is null;
