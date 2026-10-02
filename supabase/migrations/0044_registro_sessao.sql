-- Registro da sessão 1:1 de venda, preenchido pela consultora no card do lead.
-- Ao salvar, a função "plat-sessao" grava aqui e também no Essência Plat (tabela venda_sessoes),
-- que é a tela "Registro de Sessões 1:1" de lá. plat_sessao_id liga o card à linha do Plat,
-- para que uma correção feita depois atualize a mesma linha em vez de criar outra.
alter table public.deals add column if not exists sessao_registro jsonb;
alter table public.deals add column if not exists plat_sessao_id uuid;
alter table public.deals add column if not exists sessao_salva_em timestamptz;
alter table public.deals add column if not exists sessao_salva_por uuid references public.profiles(id) on delete set null;
