-- =====================================================================
-- Mensagens prontas: textos (e perguntas com opções) que a equipe envia
-- manualmente no painel de conversa com um clique.
--  options vazio  → mensagem de texto
--  1 a 3 opções   → botões de resposta rápida
--  4 a 10 opções  → lista de opções
-- =====================================================================
create table if not exists public.quick_replies (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  options     text[] not null default '{}',
  position    int not null default 0,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint quick_replies_options_max check (coalesce(array_length(options, 1), 0) <= 10)
);

alter table public.quick_replies enable row level security;
create policy "quick_replies_select" on public.quick_replies for select to authenticated using (public.is_active_user());
create policy "quick_replies_write"  on public.quick_replies for all to authenticated
  using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());

insert into public.quick_replies (title, body, options, position) values
  ('Melhor período', 'Oi, {{primeiro_nome}}! Qual o melhor período para a sua consultoria gratuita?', array['Manhã','Tarde','Noite'], 0),
  ('Confirmar interesse', 'Oi, {{primeiro_nome}}! Você ainda tem interesse na consultoria gratuita para estruturar seu consultório de enfermagem?', array['Sim, quero agendar','Agora não'], 1),
  ('Enviar horários', 'Perfeito! Vou te enviar os horários disponíveis desta semana. Um instante.', '{}', 2);
