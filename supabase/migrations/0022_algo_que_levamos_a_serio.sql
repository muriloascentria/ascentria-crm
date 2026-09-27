-- Confirmação: "É uma profissão que levamos a sério." passa a "É algo que levamos a sério."
update public.quick_replies
set body = replace(body, 'É uma profissão que levamos a sério.', 'É algo que levamos a sério.')
where body like '%É uma profissão que levamos a sério.%';
