-- Rota de Embarque do Essência Plat: negócio do pipeline Mentoria que entra em "Fechou mentoria" (ou sai dela,
-- ou vai para "Comprou e cancelou") avisa a função plat-embarque, que leva o lead para a coluna "Grupo criado"
-- do Plat. O cron de 10 em 10 minutos é a reserva, caso alguma chamada se perca.
create or replace function public.tg_plat_embarque() returns trigger language plpgsql security definer set search_path = public as $$
declare novo text; velho text;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then return new; end if;
  select name into novo from public.stages where id = new.stage_id;
  if tg_op = 'UPDATE' then select name into velho from public.stages where id = old.stage_id; end if;
  if novo in ('Fechou mentoria','Comprou e cancelou') or velho = 'Fechou mentoria' then
    perform net.http_post(
      url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/plat-embarque',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
      body := jsonb_build_object('deal_id', new.id), timeout_milliseconds := 30000);
  end if;
  return new;
end $$;
drop trigger if exists plat_embarque on public.deals;
create trigger plat_embarque after insert or update of stage_id on public.deals for each row execute function public.tg_plat_embarque();

select cron.unschedule('crm-plat-embarque') where exists (select 1 from cron.job where jobname = 'crm-plat-embarque');
select cron.schedule('crm-plat-embarque', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://rtrtfxraiaudtkkdjmkn.supabase.co/functions/v1/plat-embarque',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);
