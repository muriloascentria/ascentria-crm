-- Sem reativação automática de leads antigos (política de mensagens do WhatsApp: reenviar marketing para quem
-- não respondeu gera bloqueios/denúncias; a conta foi desativada em 03/10/2026).
-- Quem cai em uma coluna de arquivo fica lá; só volta à cadência se der sinal de novo (comentar, deixar o número, escrever).
alter table public.pipelines add column if not exists reactivate_enabled boolean not null default false;
update public.pipelines set reactivate_enabled = false, reactivate_to_pipeline_id = null;
update public.deals set reactivate_at = null where reactivate_at is not null;

create or replace function public.deals_cadence_on_enter()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  st public.stages;
  pl public.pipelines;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    select * into st from public.stages where id = new.stage_id;
    if st.role = 'day' and (st.message_text is not null or st.wa_template_name is not null) then
      perform public.queue_stage_message(new, st);
    end if;
    if st.role = 'archived' then
      select * into pl from public.pipelines where id = new.pipeline_id;
      -- reativação automática só se o funil estiver configurado para isso (desligada por padrão)
      update public.deals set reactivate_at = case when pl.reactivate_enabled
        then current_date + (pl.archive_months || ' months')::interval else null end
      where id = new.id;
    end if;
  end if;
  return null;
end;
$function$;
