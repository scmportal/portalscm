-- ============================================================
-- Tabela: feedbacks
-- Canal de sugestões, dúvidas, bugs e elogios enviados por clientes
-- e respondidos pelo admin (mini sistema de tickets).
--
-- Como usar:
-- 1. Abra o painel do Supabase → SQL Editor
-- 2. Cole este arquivo inteiro e execute
-- 3. Confirme que a tabela "feedbacks" aparece em Database → Tables
--    e que as policies (RLS) estão ativas
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.feedbacks (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.usuarios(id) on delete cascade,
  cliente_nome    text not null,
  cliente_empresa text,
  cliente_cnpj    text,
  categoria       text not null check (categoria in ('sugestao','duvida','problema','outro')),
  assunto         text not null check (char_length(assunto) between 4 and 120),
  mensagem        text not null check (char_length(mensagem) >= 10),
  status          text not null default 'pendente' check (status in ('pendente','visto','respondido')),
  admin_resposta  text,
  admin_id        uuid references public.usuarios(id) on delete set null,
  admin_nome      text,
  respondido_em   timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_feedbacks_cliente_created on public.feedbacks (cliente_id, created_at desc);
create index if not exists idx_feedbacks_status          on public.feedbacks (status);
create index if not exists idx_feedbacks_categoria       on public.feedbacks (categoria);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.feedbacks enable row level security;

-- SELECT: cliente vê só os próprios; admin vê tudo
drop policy if exists "feedbacks_select_own_or_admin" on public.feedbacks;
create policy "feedbacks_select_own_or_admin"
  on public.feedbacks for select
  using (
    cliente_id = auth.uid()
    or exists (select 1 from public.usuarios u where u.id = auth.uid() and u.role = 'admin')
  );

-- INSERT: usuário autenticado pode inserir feedback como ele mesmo
drop policy if exists "feedbacks_insert_self" on public.feedbacks;
create policy "feedbacks_insert_self"
  on public.feedbacks for insert
  with check (cliente_id = auth.uid());

-- UPDATE: apenas admin (para responder e mudar status)
drop policy if exists "feedbacks_update_admin" on public.feedbacks;
create policy "feedbacks_update_admin"
  on public.feedbacks for update
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.role = 'admin'));

-- DELETE: apenas admin
drop policy if exists "feedbacks_delete_admin" on public.feedbacks;
create policy "feedbacks_delete_admin"
  on public.feedbacks for delete
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.role = 'admin'));

-- ============================================================
-- Realtime (para o admin ver novos feedbacks chegando ao vivo)
-- ============================================================
alter publication supabase_realtime add table public.feedbacks;
