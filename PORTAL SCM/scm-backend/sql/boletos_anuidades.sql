-- ============================================================
-- Tabela: boletos_anuidades
-- Armazena boletos anuais anexados pelos consultores/admin para os
-- clientes (ANATEL, CREA/CFT e ANCINE). Os arquivos em si ficam no
-- bucket de Storage "boletos-anuidades".
--
-- Como usar:
-- 1. Abra o painel do Supabase → SQL Editor
-- 2. Cole este arquivo inteiro e execute
-- 3. Crie o bucket "boletos-anuidades" (Storage → New bucket).
--    Pode ficar "Public OFF" — o download é feito pelo cliente
--    autenticado via supabase.storage.from(...).download(...)
-- 4. Confira que a tabela aparece em Database → Tables e as policies
--    de RLS estão ativas.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.boletos_anuidades (
  id                uuid primary key default gen_random_uuid(),

  cnpj              text not null,
  cliente_nome      text,

  tipo              text not null check (tipo in ('anatel','crea_cft','ancine')),
  ano               integer not null check (ano between 2000 and 2100),

  observacao        text,

  nome_original     text not null,
  arquivo_path      text not null,
  tamanho_bytes     bigint,
  tipo_arquivo      text,

  enviado_por       uuid references public.usuarios(id) on delete set null,
  enviado_por_nome  text,

  criado_em         timestamptz not null default now()
);

create index if not exists idx_boletos_anuidades_cnpj_tipo_ano
  on public.boletos_anuidades (cnpj, tipo, ano desc);

create index if not exists idx_boletos_anuidades_tipo_ano
  on public.boletos_anuidades (tipo, ano desc);

create index if not exists idx_boletos_anuidades_criado
  on public.boletos_anuidades (criado_em desc);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.boletos_anuidades enable row level security;

-- SELECT: admin e consultor veem tudo; cliente vê apenas os do próprio CNPJ
drop policy if exists "boletos_anuidades_select" on public.boletos_anuidades;
create policy "boletos_anuidades_select"
  on public.boletos_anuidades for select
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.role in ('admin','consult')
    )
    or exists (
      select 1 from public.usuarios u
      where u.id = auth.uid()
        and u.role = 'client'
        and regexp_replace(coalesce(u.cnpj,''), '\D', '', 'g')
            = regexp_replace(coalesce(public.boletos_anuidades.cnpj,''), '\D', '', 'g')
    )
  );

-- INSERT: apenas admin e consultor
drop policy if exists "boletos_anuidades_insert" on public.boletos_anuidades;
create policy "boletos_anuidades_insert"
  on public.boletos_anuidades for insert
  with check (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.role in ('admin','consult')
    )
  );

-- UPDATE: apenas admin e consultor
drop policy if exists "boletos_anuidades_update" on public.boletos_anuidades;
create policy "boletos_anuidades_update"
  on public.boletos_anuidades for update
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.role in ('admin','consult')
    )
  )
  with check (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.role in ('admin','consult')
    )
  );

-- DELETE: apenas admin e consultor
drop policy if exists "boletos_anuidades_delete" on public.boletos_anuidades;
create policy "boletos_anuidades_delete"
  on public.boletos_anuidades for delete
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.role in ('admin','consult')
    )
  );

-- ============================================================
-- Realtime (para que cliente veja novo boleto aparecendo ao vivo)
-- ============================================================
alter publication supabase_realtime add table public.boletos_anuidades;

-- ============================================================
-- Storage — policies do bucket "boletos-anuidades"
-- Crie o bucket manualmente em Storage → New bucket (privado).
-- Depois rode as policies abaixo para liberar leitura ao dono do
-- CNPJ e escrita ao consultor/admin.
-- ============================================================

-- SELECT no bucket: admin/consult tudo; client só os do próprio CNPJ
drop policy if exists "boletos_anuidades_storage_select" on storage.objects;
create policy "boletos_anuidades_storage_select"
  on storage.objects for select
  using (
    bucket_id = 'boletos-anuidades'
    and (
      exists (
        select 1 from public.usuarios u
        where u.id = auth.uid() and u.role in ('admin','consult')
      )
      or exists (
        select 1 from public.usuarios u
        where u.id = auth.uid()
          and u.role = 'client'
          and position(
            'clientes/' || regexp_replace(coalesce(u.cnpj,''), '\D', '', 'g') || '/anuidades/'
            in storage.objects.name
          ) = 1
      )
    )
  );

-- INSERT no bucket: apenas admin/consult
drop policy if exists "boletos_anuidades_storage_insert" on storage.objects;
create policy "boletos_anuidades_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'boletos-anuidades'
    and exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.role in ('admin','consult')
    )
  );

-- DELETE no bucket: apenas admin/consult
drop policy if exists "boletos_anuidades_storage_delete" on storage.objects;
create policy "boletos_anuidades_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'boletos-anuidades'
    and exists (
      select 1 from public.usuarios u
      where u.id = auth.uid() and u.role in ('admin','consult')
    )
  );
