-- =====================================================================
-- Endurecimento (recomendações do linter do Supabase)
-- =====================================================================
-- search_path fixo nas funções auxiliares
alter function public.touch_updated_at() set search_path = public;
alter function public.set_creator() set search_path = public;
alter function public.set_activity_creator() set search_path = public;
alter function public.render_template(text, public.deals, public.contacts) set search_path = public;
alter function public.render_message(text, public.contacts) set search_path = public;
alter function public.deals_touch_stage() set search_path = public;
alter function public.normalize_phone(text) set search_path = public;
alter function public.in_wa_window(public.deals) set search_path = public;
alter function public.extract_br_phone(text) set search_path = public;
alter function public.entry_stage(uuid) set search_path = public;
alter function public.first_day_stage(uuid) set search_path = public;

-- funções internas (gatilhos e motor) não devem ser chamadas pela API
revoke execute on function public.contacts_after_insert() from public, anon, authenticated;
revoke execute on function public.deals_after_change() from public, anon, authenticated;
revoke execute on function public.deals_before_change() from public, anon, authenticated;
revoke execute on function public.deals_cadence_on_enter() from public, anon, authenticated;
revoke execute on function public.deals_touch_stage() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.run_automation(public.automations, public.deals, public.contacts) from public, anon, authenticated;
revoke execute on function public.queue_stage_message(public.deals, public.stages) from public, anon, authenticated;
revoke execute on function public.default_wa_number() from public, anon;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.set_creator() from public, anon, authenticated;
revoke execute on function public.set_activity_creator() from public, anon, authenticated;

-- funções usadas pelas políticas RLS e pelo app: só para usuários logados
revoke execute on function public.can_access(uuid) from public, anon;
revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_manager_or_admin() from public, anon;
revoke execute on function public.move_inbox_to_day1(uuid, int) from public, anon;
revoke execute on function public.sent_last_24h() from public, anon;
