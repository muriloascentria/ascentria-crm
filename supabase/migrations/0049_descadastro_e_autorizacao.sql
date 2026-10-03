-- Descadastro automático e registro de autorização (política de mensagens do WhatsApp Business).
--
-- 1) contacts.marketing_opt_out: o lead pediu para não receber marketing. A partir daí:
--      - sai da cadência (vai para "Perdido desinteresse") e não volta sozinho;
--      - nenhum modelo de marketing entra na fila para ele (só os lembretes de encontro já marcado).
--    Vira opt-out quando:
--      - o lead escreve SAIR / PARAR / CANCELAR / NÃO QUERO (MAIS) (RECEBER) / STOP / DESCADASTRAR,
--        ou toca no botão "Não quero receber" → recebe uma única confirmação;
--      - a Meta recusa um envio porque o lead escolheu parar de receber marketing.
-- 2) contacts.optin: de onde e quando veio a autorização (canal, data, @, texto que a pessoa viu).
-- 3) Número inválido: duas mensagens seguidas não entregues → sai da cadência (Perdido cadência).

alter table public.contacts add column if not exists marketing_opt_out boolean not null default false;
alter table public.contacts add column if not exists opt_out_at timestamptz;
alter table public.contacts add column if not exists opt_out_motivo text;
alter table public.contacts add column if not exists optin jsonb;

-- tira os cards abertos do contato da sequência automática
create or replace function public.stop_cadence_for(p_contact uuid, p_motivo text, p_coluna text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  d record;
  alvo public.stages;
  n int := 0;
begin
  for d in
    select dl.id, dl.pipeline_id, dl.owner_id, dl.title from public.deals dl join public.stages s on s.id = dl.stage_id
     where dl.contact_id = p_contact and dl.status = 'open' and s.role in ('day', 'inbox', 'reactivate', 'responsive')
  loop
    select * into alvo from public.stages
     where pipeline_id = d.pipeline_id and role = 'archived'
     order by (name ilike '%' || p_coluna || '%') desc, position limit 1;
    continue when alvo.id is null;
    update public.deals set stage_id = alvo.id where id = d.id;
    update public.deals set reactivate_at = null where id = d.id;
    insert into public.activities (type, title, description, due_at, done, done_at, deal_id, contact_id, assigned_to, created_by)
    values ('note', 'Saiu da cadência automaticamente: ' || d.title, p_motivo, now(), true, now(), d.id, p_contact, d.owner_id, d.owner_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.stop_cadence_for(uuid, text, text) from public, anon, authenticated;

create or replace function public.marcar_opt_out(p_contact uuid, p_motivo text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.contacts set marketing_opt_out = true, opt_out_at = now(), opt_out_motivo = p_motivo
   where id = p_contact and not marketing_opt_out;
  if not found then return false; end if;
  perform public.stop_cadence_for(p_contact,
    'O lead pediu para não receber mais mensagens de marketing (' || p_motivo || '). Ele sai da sequência e nunca mais recebe envios automáticos. Se ele escrever, a conversa continua normalmente.',
    'desinteresse');
  return true;
end $$;
revoke execute on function public.marcar_opt_out(uuid, text) from public, anon, authenticated;

-- mensagens recebidas: SAIR / PARAR / botão "Não quero receber"
create or replace function public.wa_messages_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t text;
  ultimos text[];
begin
  if new.direction = 'in' and new.contact_id is not null then
    t := lower(translate(trim(coalesce(new.body, '')), 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc'));
    t := regexp_replace(t, '[\s\.\!\?]+$', '');
    if t ~ '^(sair|parar|pare|cancelar|stop|descadastrar|remover|nao quero( mais)?( receber)?( mensagens?)?|nao quero receber)$' then
      if public.marcar_opt_out(new.contact_id, 'respondeu "' || left(trim(new.body), 40) || '"') then
        insert into public.wa_outbox (contact_id, deal_id, kind, body, wa_number_id)
        values (new.contact_id, new.deal_id, 'text',
          'Pronto! Você não vai mais receber nossas mensagens automáticas. Se precisar de algo, é só escrever aqui. 💚',
          coalesce(new.wa_number_id, public.default_wa_number()));
      end if;
    end if;
  end if;
  return new;
end $$;

-- envios recusados pela Meta
create or replace function public.wa_messages_on_failed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ultimos text[];
begin
  if new.direction <> 'out' or new.status <> 'failed' or new.error is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'failed' then return new; end if;
  if new.error ilike '%chosen to stop receiving%' then
    perform public.marcar_opt_out(new.contact_id, 'parou as mensagens de marketing pelo WhatsApp');
  elsif new.error ilike '%undeliverable%' then
    select array_agg(coalesce(error, '') order by created_at desc) into ultimos from (
      select error, created_at from public.wa_messages
       where contact_id = new.contact_id and direction = 'out' and template_name is not null
       order by created_at desc limit 2) x;
    if array_length(ultimos, 1) = 2 and ultimos[1] ilike '%undeliverable%' and ultimos[2] ilike '%undeliverable%' then
      perform public.stop_cadence_for(new.contact_id,
        'Duas mensagens seguidas não chegaram: o número não tem WhatsApp ou é inválido. Confira o número do contato; depois de corrigir, mova o card de volta para o Dia 1.',
        'cadência');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists wa_messages_optout on public.wa_messages;
create trigger wa_messages_optout after insert on public.wa_messages
  for each row execute function public.wa_messages_on_insert();
drop trigger if exists wa_messages_failed on public.wa_messages;
create trigger wa_messages_failed after insert or update of status on public.wa_messages
  for each row execute function public.wa_messages_on_failed();

-- trava final: modelo de marketing não entra na fila para quem pediu para sair
-- (lembretes de encontro já marcado continuam: são mensagens de serviço)
create or replace function public.wa_outbox_respeita_opt_out() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lembretes text[];
begin
  if new.kind <> 'template' then return new; end if;
  if not exists (select 1 from public.contacts where id = new.contact_id and marketing_opt_out) then return new; end if;
  select coalesce(array_agg(v->>'name'), '{}') into lembretes
    from public.org_settings s, jsonb_each(coalesce(s.reminder_templates, '{}'::jsonb)) as e(k, v) where s.id = 1;
  if new.template_name = any(lembretes) then return new; end if;
  return null;
end $$;
drop trigger if exists wa_outbox_opt_out on public.wa_outbox;
create trigger wa_outbox_opt_out before insert on public.wa_outbox
  for each row execute function public.wa_outbox_respeita_opt_out();

-- quem já pediu para sair antes (recusas da Meta já registradas)
update public.contacts c set marketing_opt_out = true, opt_out_at = coalesce(c.opt_out_at, now()),
       opt_out_motivo = coalesce(c.opt_out_motivo, 'parou as mensagens de marketing pelo WhatsApp')
 where exists (select 1 from public.wa_messages m where m.contact_id = c.id and m.status = 'failed' and m.error ilike '%chosen to stop receiving%');
