-- Telefone digitado sem o código do país (ex.: 81988864544) era enviado como se fosse de outro país
-- e a mensagem não chegava. Agora: número brasileiro com DDD (10 ou 11 dígitos) ganha o 55 na frente
-- e o WhatsApp (wa_id) é preenchido sozinho.
create or replace function public.normalize_contact_phone() returns trigger
language plpgsql set search_path = public as $$
declare
  dig text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
begin
  if dig = '' then return new; end if;
  if length(dig) in (10, 11) and left(dig, 1) <> '0' then
    dig := '55' || dig;
  end if;
  if length(dig) in (12, 13) and left(dig, 2) = '55' then
    new.phone := '+' || dig;
    if new.wa_id is null or tg_op = 'UPDATE' and new.phone is distinct from old.phone and new.wa_id is not distinct from old.wa_id then
      new.wa_id := dig;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_normalize_contact_phone on public.contacts;
create trigger trg_normalize_contact_phone before insert or update of phone, wa_id on public.contacts
for each row execute function public.normalize_contact_phone();

-- corrige os que já estavam sem o 55
update public.contacts set phone = phone
 where wa_id is null and length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) in (10, 11);
