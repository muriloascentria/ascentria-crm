-- eCRM ↔ ePLAT nas cobranças (pedido do Murilo em 25/11/2026): o que for registrado nos cards dos funis Cobrança e
-- Inadimplentes vira registro no "Registro de Cobranças Financeiras" do aluno no ePLAT, e o que a Mari registrar no
-- ePLAT aparece como nota no card. A rotina cobranca-run (a cada 5 min) faz a troca; esta tabela evita duplicar
-- registros nos dois sentidos (cada linha é reservada antes de gravar, então duas rodadas juntas não duplicam).
create table if not exists public.plat_cobranca_sync (
  id bigint generated always as identity primary key,
  activity_id uuid unique references public.activities(id) on delete set null,
  plat_registro_id bigint unique,
  direcao text not null check (direcao in ('crm_para_plat','plat_para_crm')),
  created_at timestamptz not null default now()
);
alter table public.plat_cobranca_sync enable row level security;
create policy "plat_cobranca_sync_admin" on public.plat_cobranca_sync for select to authenticated using (public.is_admin());
