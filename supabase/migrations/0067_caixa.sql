-- Cash collect: dinheiro que entra na hora da venda (ou no dia seguinte).
--   • Pix (entrada) entra cheio.
--   • Cartão de crédito parcelado por link (InfinitePay, recebimento em 1 dia útil): entra o valor todo no dia seguinte,
--     menos a taxa da InfinitePay (a Ascentria nunca repassa juros ao aluno).
--   • Pix programado e cartão recorrente NÃO são cash collect (entram mês a mês).
create table if not exists public.caixa_lancamentos (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  vendedor text not null,
  lead text,
  deal_id uuid references public.deals(id) on delete set null,
  origem text not null default 'manual',        -- 'entrada' | 'cartao' (automáticos do contrato) | 'manual'
  tipo text not null default 'venda',           -- 'venda' | 'upsell'
  forma text not null default 'pix',            -- 'pix' | 'cartao'
  parcelas int,
  bruto numeric not null,
  taxa_pct numeric not null default 0,
  liquido numeric not null,
  obs text,
  created_at timestamptz not null default now()
);
create unique index if not exists caixa_auto_uniq on public.caixa_lancamentos (deal_id, origem) where origem in ('entrada', 'cartao');
alter table public.caixa_lancamentos enable row level security;
drop policy if exists caixa_select on public.caixa_lancamentos;
create policy caixa_select on public.caixa_lancamentos for select to authenticated using (true);

-- Taxa da InfinitePay no link de pagamento, recebimento em 1 dia útil (D+1), por número de parcelas
create or replace function public.taxa_infinitepay(p_parcelas int) returns numeric language sql immutable as $$
  select (array[4.20, 6.09, 7.01, 7.91, 8.80, 9.67, 12.59, 13.42, 14.25, 15.06, 15.87, 16.66])[greatest(1, least(12, coalesce(p_parcelas, 1)))]
$$;

-- Gera os lançamentos automáticos a partir do contrato do card (quando o card está ganho)
create or replace function public.caixa_do_contrato() returns trigger language plpgsql security definer set search_path = public as $$
declare
  c jsonb := new.contrato;
  vend text;
  dt date;
  ent numeric;
  total numeric;
  forma text;
  np int;
  vp numeric;
  saldo numeric;
  up boolean;
  won boolean;
begin
  select kind = 'won' into won from stages where id = new.stage_id;
  if c is null or not coalesce(won, false) or coalesce(new.title, '') ~* 'teste' then
    delete from caixa_lancamentos where deal_id = new.id and origem in ('entrada', 'cartao');
    return new;
  end if;
  vend := coalesce(nullif(new.sessao_registro->>'vendedor', ''), (select name from calendar_sellers where id = new.seller_id), '—');
  dt := coalesce(nullif(c->>'data', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  ent := coalesce(public.valor_brl(c->>'entrada'), 0);
  total := coalesce(public.valor_brl(c->>'valor_total'), new.value, 0);
  forma := lower(coalesce(c->>'forma_pagamento', ''));
  up := coalesce((new.sessao_registro->>'upsell')::boolean, false);
  if ent > 0 then
    insert into caixa_lancamentos (data, vendedor, lead, deal_id, origem, tipo, forma, bruto, taxa_pct, liquido, obs)
    values (dt, vend, new.title, new.id, 'entrada', case when up then 'upsell' else 'venda' end, 'pix', ent, 0, ent, 'Entrada do contrato')
    on conflict (deal_id, origem) where origem in ('entrada', 'cartao')
    do update set data = excluded.data, vendedor = excluded.vendedor, tipo = excluded.tipo, bruto = excluded.bruto, liquido = excluded.liquido;
  else
    delete from caixa_lancamentos where deal_id = new.id and origem = 'entrada';
  end if;
  -- saldo no cartão de crédito parcelado (não recorrente): entra todo no dia seguinte, menos a taxa
  if forma ~ 'cart' and forma ~ 'cr[eé]dito' and forma !~ 'recorr' then
    saldo := greatest(total - ent, 0);
    vp := public.valor_brl(c->>'valor_parcela');
    np := coalesce(nullif(regexp_replace(coalesce(c->>'num_parcelas', ''), '\D', '', 'g'), '')::int,
                   case when vp > 0 then round(saldo / vp)::int end, 1);
    if saldo > 0 then
      insert into caixa_lancamentos (data, vendedor, lead, deal_id, origem, tipo, forma, parcelas, bruto, taxa_pct, liquido, obs)
      values (dt + 1, vend, new.title, new.id, 'cartao', case when up then 'upsell' else 'venda' end, 'cartao', np, saldo,
              public.taxa_infinitepay(np), round(saldo * (1 - public.taxa_infinitepay(np) / 100), 2), 'Cartão de crédito por link (InfinitePay, D+1)')
      on conflict (deal_id, origem) where origem in ('entrada', 'cartao')
      do update set data = excluded.data, vendedor = excluded.vendedor, tipo = excluded.tipo, parcelas = excluded.parcelas,
                    bruto = excluded.bruto, taxa_pct = excluded.taxa_pct, liquido = excluded.liquido;
    end if;
  else
    delete from caixa_lancamentos where deal_id = new.id and origem = 'cartao';
  end if;
  return new;
end $$;
drop trigger if exists caixa_do_contrato on public.deals;
create trigger caixa_do_contrato after insert or update of contrato, stage_id, sessao_registro, seller_id on public.deals
  for each row execute function public.caixa_do_contrato();

-- Resumo do caixa por vendedor no período
create or replace function public.caixa_resumo(p_ini date, p_fim date)
returns table(vendedor text, liquido numeric, bruto numeric, vendas_liq numeric, upsell_liq numeric)
language sql stable security definer set search_path = public as $$
  select vendedor, sum(liquido), sum(bruto),
         sum(liquido) filter (where tipo = 'venda'), sum(liquido) filter (where tipo = 'upsell')
  from caixa_lancamentos where data >= p_ini and data < p_fim and auth.uid() is not null
  group by vendedor
$$;

-- Placar do mês: "Cash collect" passa a vir do caixa (Pix + cartão líquido, inclui upsell)
CREATE OR REPLACE FUNCTION public.vendas_resumo(p_ini timestamp with time zone, p_fim timestamp with time zone)
 RETURNS TABLE(vendas integer, total numeric, entradas numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with v as (
    select d.value,
           coalesce((select max(h.changed_at) from deal_stage_history h join stages st on st.id = h.to_stage_id
                     where h.deal_id = d.id and st.kind = 'won'), d.closed_at) quando
    from deals d
    where d.status = 'won' and d.title !~* 'teste'
      and coalesce(d.sessao_registro->>'upsell', 'false') <> 'true'
  )
  select (select count(*)::int from v where quando >= p_ini and quando < p_fim),
         (select coalesce(sum(value), 0) from v where quando >= p_ini and quando < p_fim),
         (select coalesce(sum(liquido), 0) from caixa_lancamentos
           where data >= (p_ini at time zone 'America/Sao_Paulo')::date and data < (p_fim at time zone 'America/Sao_Paulo')::date)
  where auth.uid() is not null
$function$;
