-- Vendas do mês (motivação da equipe): valor das vendas fechadas e entradas recebidas na call, por consultora.
-- O valor do card passa a vir sozinho do contrato (valor total) e, sem contrato, do registro da sessão.

create or replace function public.valor_brl(t text) returns numeric
language sql immutable as $$
  select case
    when coalesce(t, '') !~ '\d' then null
    when regexp_replace(t, '[^0-9,.\-]', '', 'g') ~ ',' then
      nullif(replace(replace(regexp_replace(t, '[^0-9,.\-]', '', 'g'), '.', ''), ',', '.'), '')::numeric
    when regexp_replace(t, '[^0-9.\-]', '', 'g') ~ '\.\d{3}$' or regexp_replace(t, '[^0-9.\-]', '', 'g') ~ '\..*\.' then
      nullif(replace(regexp_replace(t, '[^0-9.\-]', '', 'g'), '.', ''), '')::numeric
    else nullif(regexp_replace(t, '[^0-9.\-]', '', 'g'), '')::numeric
  end
$$;

create or replace function public.deals_valor_sync() returns trigger
language plpgsql as $$
declare v numeric;
begin
  -- contrato preenchido/alterado: o valor do card é o valor total do contrato
  if new.contrato is not null and (tg_op = 'INSERT' or new.contrato is distinct from old.contrato) then
    v := public.valor_brl(new.contrato->>'valor_total');
    if v > 0 then new.value := v; end if;
  end if;
  -- sem valor ainda: usa o valor da venda anotado no registro da sessão
  if coalesce(new.value, 0) = 0 and new.sessao_registro is not null then
    v := public.valor_brl(new.sessao_registro->>'valor');
    if v > 0 then new.value := v; end if;
  end if;
  return new;
end $$;

drop trigger if exists deals_valor_sync on public.deals;
create trigger deals_valor_sync before insert or update of contrato, sessao_registro on public.deals
  for each row execute function public.deals_valor_sync();

-- vendas já fechadas sem valor: completa pelo contrato ou pelo registro da sessão
update public.deals d set value = coalesce(nullif(public.valor_brl(d.contrato->>'valor_total'), 0), public.valor_brl(d.sessao_registro->>'valor'))
where d.status = 'won' and coalesce(d.value, 0) = 0
  and coalesce(nullif(public.valor_brl(d.contrato->>'valor_total'), 0), public.valor_brl(d.sessao_registro->>'valor'), 0) > 0
  and d.title !~* 'teste';

/** Resumo das vendas no período, por consultora (todas as consultoras veem o placar da equipe).
 *  Data da venda = última vez que o card entrou numa coluna de venda (ou closed_at). Cards de teste ficam fora. */
create or replace function public.vendas_resumo(p_ini timestamptz, p_fim timestamptz)
returns table (consultora text, vendas int, total numeric, entradas numeric)
language sql stable security definer set search_path = public as $$
  with v as (
    select d.id, d.value, coalesce(s.name, 'Sem consultora') consultora,
           coalesce(public.valor_brl(d.contrato->>'entrada'), 0) entrada,
           coalesce((select max(h.changed_at) from deal_stage_history h join stages st on st.id = h.to_stage_id
                     where h.deal_id = d.id and st.kind = 'won'), d.closed_at) quando
    from deals d left join calendar_sellers s on s.id = d.seller_id
    where d.status = 'won' and d.title !~* 'teste'
  )
  select consultora, count(*)::int, coalesce(sum(value), 0), coalesce(sum(entrada), 0)
  from v where quando >= p_ini and quando < p_fim and auth.uid() is not null
  group by consultora order by 3 desc, 2 desc
$$;
grant execute on function public.vendas_resumo(timestamptz, timestamptz) to authenticated;
