-- Modelos de marketing não entram na fila para:
--  * quem pediu para sair (marketing_opt_out);
--  * contatos da lista antiga importada ("CRM antigo") sem autorização registrada (optin).
-- Lembretes de encontro já marcado continuam (mensagens de serviço). Textos livres (respostas na janela de 24h) continuam.
create or replace function public.wa_outbox_respeita_opt_out() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lembretes text[];
  c record;
begin
  if new.kind <> 'template' then return new; end if;
  select marketing_opt_out, source, optin into c from public.contacts where id = new.contact_id;
  if not found then return new; end if;
  if not (c.marketing_opt_out or (c.source = 'CRM antigo' and c.optin is null)) then return new; end if;
  select coalesce(array_agg(v->>'name'), '{}') into lembretes
    from public.org_settings s, jsonb_each(coalesce(s.reminder_templates, '{}'::jsonb)) as e(k, v) where s.id = 1;
  if new.template_name = any(lembretes) then return new; end if;
  return null;
end $$;
