-- Funis que certos usuários não veem (pedido do Murilo em 21/11/2026):
-- o funil "Método Essência" não aparece para a Adriana, que só vende mentoria.
alter table public.pipelines add column if not exists hidden_from uuid[] not null default '{}';

-- security definer: a checagem enxerga o funil mesmo quando o próprio funil está oculto para o usuário.
create or replace function public.funil_oculto(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_admin() and exists (
    select 1 from public.pipelines where id = p and auth.uid() = any(hidden_from));
$$;

drop policy if exists "pipelines_select" on public.pipelines;
create policy "pipelines_select" on public.pipelines for select to authenticated
  using (public.is_active_user() and not public.funil_oculto(id));

drop policy if exists "stages_select" on public.stages;
create policy "stages_select" on public.stages for select to authenticated
  using (public.is_active_user() and not public.funil_oculto(pipeline_id));

drop policy if exists "deals_select" on public.deals;
create policy "deals_select" on public.deals for select to authenticated
  using (public.can_access(owner_id) and not public.funil_oculto(pipeline_id));

update public.pipelines set hidden_from = array['4b9e0b58-752d-4ffd-9a06-00027a5f388b']::uuid[]
 where id = '025aeaf7-1103-48e0-86ca-94d4c05c5e0e';
