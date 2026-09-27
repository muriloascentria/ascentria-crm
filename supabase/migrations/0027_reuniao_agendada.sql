-- Coluna "Reunião agendada" (sem mensagem automática) logo depois de Responsivo, nos funis com cadência.
do $$
declare p record; resp public.stages;
begin
  for p in select distinct pipeline_id from public.stages where role = 'responsive' loop
    if exists (select 1 from public.stages where pipeline_id = p.pipeline_id and name = 'Reunião agendada') then continue; end if;
    select * into resp from public.stages where pipeline_id = p.pipeline_id and role = 'responsive' order by position limit 1;
    update public.stages set position = position + 1 where pipeline_id = p.pipeline_id and position > resp.position;
    insert into public.stages (pipeline_id, name, position, color, probability, kind, role, wa_template_lang, auto_send)
    values (p.pipeline_id, 'Reunião agendada', resp.position + 1, '#3f6b4a', 70, 'open', null, 'pt_BR', false);
  end loop;
end $$;

-- {{primeiro_nome}}: se o "nome" for um telefone ou "Sem nome…", usa o @ do Instagram ou "tudo bem".
create or replace function public.lead_first_name(c public.contacts) returns text
language sql immutable set search_path = public as $$
  select coalesce(
    case when split_part(coalesce(c.name, ''), ' ', 1) ~ '[0-9+@]' or c.name ilike 'sem nome%' then null
         else nullif(split_part(coalesce(c.name, ''), ' ', 1), '') end,
    nullif(c.ig_username, ''), 'tudo bem')
$$;

create or replace function public.queue_stage_message(d public.deals, st public.stages)
returns void language plpgsql security definer set search_path = public as $function$
declare
  c public.contacts;
  msg text;
  params jsonb;
begin
  select * into c from public.contacts where id = d.contact_id;
  if c.id is null or c.wa_id is null then return; end if;
  msg := public.render_message(st.message_text, c);
  params := case
    when coalesce(st.message_text, '') ~ '\{\{(primeiro_nome|nome)\}\}'
      then jsonb_build_array(public.lead_first_name(c))
    else '[]'::jsonb
  end;

  if st.auto_send and (st.wa_template_name is not null or public.in_wa_window(d)) then
    if public.in_wa_window(d) and msg <> '' then
      insert into public.wa_outbox (contact_id, deal_id, kind, body, wa_number_id) values (c.id, d.id, 'text', msg, coalesce(d.wa_number_id, public.default_wa_number()));
    else
      insert into public.wa_outbox (contact_id, deal_id, kind, template_name, template_lang, template_params, wa_number_id)
      values (c.id, d.id, 'template', st.wa_template_name, st.wa_template_lang, params, coalesce(d.wa_number_id, public.default_wa_number()));
    end if;
  else
    insert into public.activities (type, title, description, due_at, deal_id, contact_id, assigned_to, created_by)
    values ('whatsapp', 'Enviar mensagem — ' || st.name || ': ' || d.title, nullif(msg, ''), now(), d.id, c.id, d.owner_id, d.owner_id);
  end if;
end;
$function$;

create or replace function public.render_message(tpl text, c public.contacts)
returns text language plpgsql set search_path = public as $function$
begin
  tpl := coalesce(tpl, '');
  tpl := replace(tpl, '{{nome}}', case when public.lead_first_name(c) = 'tudo bem' then 'tudo bem' else coalesce(c.name, '') end);
  tpl := replace(tpl, '{{primeiro_nome}}', public.lead_first_name(c));
  return tpl;
end;
$function$;
