-- =====================================================================
-- Textos oficiais da sequência Dia 1 → Dia 5 (funil de Mentoria)
-- e envio da variável {{1}} do template só quando a mensagem usa o nome.
-- =====================================================================

update public.stages s set message_text = v.msg
from (values
  ('Dia 1', E'Oi, {{primeiro_nome}}! Aqui é a Mari, do time do enfermeiro Murilo Pedroso. Você solicitou no Instagram uma consultoria gratuita para estruturar seu consultório de enfermagem com faturamento de mais de 10 mil reais mensais.\nPosso te passar os horários disponíveis para esta semana?'),
  ('Dia 2', E'Poderia ouvir o áudio que enviei?'),
  ('Dia 3', E'Oi, {{primeiro_nome}}! Você ainda tem interesse na consultoria para estruturar seu consultório de enfermagem com a meta de faturar pelo menos R$ 10 mil por mês? Se tiver alguma dúvida antes de agendar, pode me falar por aqui.'),
  ('Dia 4', E'Oi, {{primeiro_nome}}! Passando para retomar a consultoria gratuita que você pediu pelo Instagram. Posso te enviar os horários disponíveis para agendarmos?'),
  ('Dia 5', E'{{primeiro_nome}}, esta é minha última mensagem sobre a consultoria gratuita que você pediu pelo Instagram.\nSe ainda quiser agendar, responda SIM que te envio os horários. Se não for o momento, responda NÃO e encerro o contato por aqui.')
) as v(name, msg)
where s.pipeline_id = '00000000-0000-0000-0000-000000000002' and s.role = 'day' and s.name = v.name;

-- Template sem variável (ex.: Dia 2) não pode receber parâmetro: a Meta recusa o envio.
create or replace function public.queue_stage_message(d public.deals, st public.stages)
returns void language plpgsql security definer set search_path = public as $$
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
      then jsonb_build_array(coalesce(nullif(split_part(coalesce(c.name, ''), ' ', 1), ''), nullif(c.ig_username, ''), 'tudo bem'))
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
$$;
