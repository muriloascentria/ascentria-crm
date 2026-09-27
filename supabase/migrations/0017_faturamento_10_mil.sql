-- Meta de faturamento citada nas mensagens prontas passa de R$ 15 mil para R$ 10 mil por mês.
update public.quick_replies
set body = replace(replace(body, 'R$ 15 mil', 'R$ 10 mil'), 'R$ 15.000,00', 'R$ 10.000,00')
where body like '%R$ 15 mil%' or body like '%R$ 15.000,00%';
