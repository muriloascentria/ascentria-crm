-- eCRM ↔ ePLAT nas cobranças (pedido do Murilo em 25/11/2026): o que for registrado nos cards dos funis Cobrança e
-- Inadimplentes vira registro no "Registro de Cobranças Financeiras" do aluno no ePLAT, e o que a Mari registrar no
-- ePLAT aparece como nota no card. Esta tabela evita duplicar registros nos dois sentidos.
create table if not exists public.plat_cobranca_sync (
  id bigint generated always as identity primary key,
  activity_id uuid unique references public.activities(id) on delete set null,
  plat_registro_id bigint unique,
  direcao text not null check (direcao in ('crm_para_plat','plat_para_crm')),
  created_at timestamptz not null default now()
);
alter table public.plat_cobranca_sync enable row level security;
create policy "plat_cobranca_sync_admin" on public.plat_cobranca_sync for select to authenticated using (public.is_admin());

-- assim que alguém registra algo num card desses funis, a sincronização roda na hora (sem esperar os 5 minutos)
create or replace function public.tg_cobranca_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deal_id is null or coalesce(new.title,'') ~ '^(Parcela vence|Não pagou no vencimento|Pagamento confirmado no ePLAT|Em atraso no financeiro da Plat|Registro no ePLAT)' then return new; end if;
  if exists (select 1 from public.deals d where d.id = new.deal_id and d.pipeline_id in ('1731d20c-e32a-4a67-a537-b8bc653c1e1f','2354ef40-0887-44f4-b584-e9c1c2bd2315')) then
    perform net.http_post(
      url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/cobranca-run',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
      body := '{}'::jsonb, timeout_milliseconds := 120000);
  end if;
  return new;
end $$;
drop trigger if exists cobranca_sync on public.activities;
create trigger cobranca_sync after insert on public.activities for each row execute function public.tg_cobranca_sync();
