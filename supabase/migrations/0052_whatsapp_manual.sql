-- WhatsApp em modo manual (conta da API desativada pela Meta).
-- O CRM continua organizando a sequência (Dia 1 → Dia 5), mas quem envia é a equipe, pelo WhatsApp dela:
--  * o card mostra a mensagem do dia pronta; "Abrir no WhatsApp" abre a conversa com o texto e marca como enviada;
--  * no dia seguinte ao envio, o card passa sozinho para o próximo Dia (depois do Dia 5 → Perdido cadência);
--  * "Respondeu" leva o card para Responsivo, e ele NÃO volta sozinho para a sequência (o CRM não vê as respostas);
--  * lembretes de encontro viram tarefa com o texto pronto, em vez de tentar sair pela API.

alter table public.org_settings add column if not exists wa_mode text not null default 'api';
alter table public.org_settings drop constraint if exists org_settings_wa_mode_check;
alter table public.org_settings add constraint org_settings_wa_mode_check check (wa_mode in ('api', 'manual'));
update public.org_settings set wa_mode = 'manual' where id = 1;

alter table public.deals add column if not exists manual_sent_at timestamptz;
alter table public.deals add column if not exists manual_sent_stage uuid;

create or replace function public.wa_manual() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select wa_mode = 'manual' from public.org_settings where id = 1), false)
$$;

-- Avanço da sequência manual: enviado num Dia em um dia anterior (horário de Brasília) → próximo Dia.
create or replace function public.avancar_cadencia_manual() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  nxt public.stages;
  n int := 0;
  hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  for r in
    select d.id, d.pipeline_id, s.position
      from public.deals d join public.stages s on s.id = d.stage_id
     where d.status = 'open' and s.role = 'day'
       and d.manual_sent_stage = d.stage_id and d.manual_sent_at < hoje
  loop
    select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'day' and position > r.position order by position limit 1;
    if nxt.id is null then
      select * into nxt from public.stages where pipeline_id = r.pipeline_id and role = 'archived'
       order by (name ilike '%cadência%') desc, position limit 1;
    end if;
    continue when nxt.id is null;
    update public.deals set stage_id = nxt.id where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.avancar_cadencia_manual() from public, anon, authenticated;

-- Responsivo parado não volta sozinho no modo manual (a conversa acontece fora do CRM);
-- o motor (a cada 5 min) usa esse mesmo ponto para avançar a sequência manual.
do $do$
declare src text;
begin
  src := pg_get_functiondef('public.return_stale_responsive()'::regprocedure);
  if position('wa_manual()' in src) = 0 then
    src := regexp_replace(src, 'begin(\r?\n)(\s*)for r in',
      'begin\1\2if public.wa_manual() then return public.avancar_cadencia_manual(); end if;\1\2for r in');
    execute src;
  end if;

  src := pg_get_functiondef('public.queue_meeting_reminders()'::regprocedure);
  if position('wa_manual()' in src) = 0 then
    src := regexp_replace(src, 'if c\.wa_id is null then',
      'if public.wa_manual() then' || chr(10) || '        motivo := ''WhatsApp em modo manual: envie pelo seu WhatsApp'';' || chr(10) || '      elsif c.wa_id is null then');
    execute src;
  end if;
end $do$;
