-- Placar de vendas do mês: upsell (sessao_registro.upsell = true) não conta como venda nova
CREATE OR REPLACE FUNCTION public.vendas_resumo(p_ini timestamp with time zone, p_fim timestamp with time zone)
 RETURNS TABLE(vendas integer, total numeric, entradas numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with v as (
    select d.value,
           coalesce(public.valor_brl(d.contrato->>'entrada'), 0) entrada,
           coalesce((select max(h.changed_at) from deal_stage_history h join stages st on st.id = h.to_stage_id
                     where h.deal_id = d.id and st.kind = 'won'), d.closed_at) quando
    from deals d
    where d.status = 'won' and d.title !~* 'teste'
      and coalesce(d.sessao_registro->>'upsell', 'false') <> 'true'
  )
  select count(*)::int, coalesce(sum(value), 0), coalesce(sum(entrada), 0)
  from v where quando >= p_ini and quando < p_fim and auth.uid() is not null
$function$;
