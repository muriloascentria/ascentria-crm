-- Nono dígito: a Meta identifica muitos celulares brasileiros SEM o 9 (ex.: 558186165288),
-- enquanto a planilha importada tinha o número COM o 9 (5581986165288).
-- Quando o lead respondia, o CRM não reconhecia o cadastro antigo, criava um contato novo
-- e o card antigo continuava recebendo a cadência (ex.: "Poderia ouvir o áudio que enviei?").
-- Agora os dois formatos são tratados como o mesmo número.

-- chave de comparação: 55 + DDD + 8 últimos dígitos (tira o 9 extra quando houver)
create or replace function public.br_phone_key(p text) returns text
language sql immutable set search_path = public as $$
  with d as (select public.normalize_phone(p) n)
  select case
    when n is null or n = '' then null
    when n like '55%' and length(n) = 13 and substr(n, 5, 1) = '9' then left(n, 4) || substr(n, 6)
    else n end
  from d
$$;

create index if not exists contacts_wa_key_idx on public.contacts (public.br_phone_key(wa_id));
create index if not exists contacts_phone_key_idx on public.contacts (public.br_phone_key(phone));

-- acha o contato pelo número, aceitando com ou sem o 9; prefere quem tem negócio aberto
create or replace function public.find_contact_by_phone(p text) returns uuid
language sql stable set search_path = public as $$
  select c.id from public.contacts c
   where public.br_phone_key(c.wa_id) = public.br_phone_key(p)
      or public.br_phone_key(c.phone) = public.br_phone_key(p)
   order by (c.wa_id = p) desc,
            exists (select 1 from public.deals d where d.contact_id = c.id and d.status = 'open') desc,
            c.created_at
   limit 1
$$;

CREATE OR REPLACE FUNCTION public.wa_inbound(p_wa_id text, p_wa_name text, p_message_id text, p_type text, p_body text, p_raw jsonb, p_ts timestamp with time zone DEFAULT now(), p_phone_number_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c public.contacts;
  d public.deals;
  pipe_id uuid;
  resp_stage public.stages;
  cur public.stages;
  num_id uuid;
  admin_id uuid := (select id from public.profiles where role = 'admin' and active order by created_at limit 1);
  created_contact boolean := false;
  created_deal boolean := false;
  moved boolean := false;
begin
  if p_message_id is not null and exists (select 1 from public.wa_messages where wa_message_id = p_message_id) then
    return jsonb_build_object('duplicate', true);
  end if;

  select id into num_id from public.wa_numbers where phone_number_id = p_phone_number_id;
  num_id := coalesce(num_id, public.default_wa_number());

  select * into c from public.contacts where id = public.find_contact_by_phone(p_wa_id);
  if c.id is null then
    insert into public.contacts (name, phone, wa_id, wa_name, source, tags)
    values (coalesce(nullif(p_wa_name, ''), '+' || p_wa_id), '+' || p_wa_id, p_wa_id, p_wa_name, 'WhatsApp', array['whatsapp'])
    returning * into c;
    created_contact := true;
  else
    -- guarda o número no formato que a Meta usa (é para ele que as respostas vão)
    update public.contacts set wa_id = p_wa_id, wa_name = coalesce(p_wa_name, wa_name) where id = c.id;
  end if;

  select * into d from public.deals where id = public.open_cadence_deal(c.id);
  pipe_id := coalesce(d.pipeline_id, public.entry_pipeline());

  if pipe_id is not null then
    select * into resp_stage from public.stages where pipeline_id = pipe_id and role = 'responsive' order by position limit 1;
    if d.id is null then
      insert into public.deals (title, pipeline_id, stage_id, contact_id, owner_id, last_inbound_at, wa_number_id)
      values (coalesce(nullif(c.name, ''), '+' || p_wa_id) || ' — WhatsApp', pipe_id,
              coalesce(resp_stage.id, public.entry_stage(pipe_id), public.first_day_stage(pipe_id)), c.id, admin_id, p_ts, num_id)
      returning * into d;
      created_deal := true;
    else
      select * into cur from public.stages where id = d.stage_id;
      if cur.role in ('inbox', 'day', 'archived', 'reactivate') and resp_stage.id is not null then
        update public.deals set stage_id = resp_stage.id, last_inbound_at = p_ts, wa_number_id = coalesce(wa_number_id, num_id) where id = d.id;
        moved := true;
      else
        update public.deals set last_inbound_at = p_ts, wa_number_id = coalesce(wa_number_id, num_id) where id = d.id;
      end if;
    end if;
  end if;

  insert into public.wa_messages (contact_id, deal_id, direction, wa_message_id, type, body, status, raw, channel, created_at)
  values (c.id, d.id, 'in', p_message_id, coalesce(p_type, 'text'), p_body, 'received', p_raw, 'whatsapp', p_ts);

  update public.org_settings set wa_connected = true, wa_last_event_at = now() where id = 1;
  return jsonb_build_object('contact_id', c.id, 'deal_id', d.id, 'created_contact', created_contact, 'created_deal', created_deal, 'moved_to_responsive', moved);
end;
$function$;
