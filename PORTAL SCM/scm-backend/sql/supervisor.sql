-- =========================================================
-- SUPERVISOR — perfil, constraint de role e RLS
-- =========================================================
-- ⚠️ Este script habilita RLS em várias tabelas. Rode primeiro em
--    staging. Idempotente: pode rodar mais de uma vez sem efeito
--    colateral.
-- =========================================================

-- 1) Permitir role = 'supervisor' em public.usuarios
DO $$
DECLARE
  c text;
BEGIN
  SELECT conname INTO c
  FROM   pg_constraint
  WHERE  conrelid = 'public.usuarios'::regclass
  AND    contype  = 'c'
  AND    pg_get_constraintdef(oid) ILIKE '%role%';

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.usuarios DROP CONSTRAINT %I', c);
  END IF;
END$$;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_role_check
  CHECK (role IN ('admin','consult','client','supervisor'));

-- 2) Helpers para identificar o usuário público da requisição
--    Usa auth.uid() primeiro, fallback por e-mail (cobre divergência
--    id auth.users != usuarios.id)
CREATE OR REPLACE VIEW public.v_current_user AS
SELECT u.*
FROM   public.usuarios u
WHERE  u.id::text = auth.uid()::text
   OR  lower(u.email) = lower(coalesce(auth.jwt() ->> 'email',''));

CREATE OR REPLACE FUNCTION public.fn_current_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.v_current_user LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_current_cnpj()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT cnpj FROM public.v_current_user LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_current_user_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id::text FROM public.v_current_user LIMIT 1;
$$;

-- 3) Habilita RLS nas tabelas relevantes
ALTER TABLE public.usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planilhas_coleta  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comprovantes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_gerais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fust_funttel          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fust_funttel_boletos  ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- USUARIOS
-- =========================================================
DROP POLICY IF EXISTS usuarios_select        ON public.usuarios;
CREATE POLICY usuarios_select ON public.usuarios FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','consult','supervisor')
  OR id::text = public.fn_current_user_id()
);

DROP POLICY IF EXISTS usuarios_update_admin  ON public.usuarios;
CREATE POLICY usuarios_update_admin ON public.usuarios FOR UPDATE TO authenticated
  USING      (public.fn_current_role() = 'admin')
  WITH CHECK (public.fn_current_role() = 'admin');

DROP POLICY IF EXISTS usuarios_insert_admin  ON public.usuarios;
CREATE POLICY usuarios_insert_admin ON public.usuarios FOR INSERT TO authenticated
  WITH CHECK (public.fn_current_role() = 'admin');

DROP POLICY IF EXISTS usuarios_delete_admin  ON public.usuarios;
CREATE POLICY usuarios_delete_admin ON public.usuarios FOR DELETE TO authenticated
  USING (public.fn_current_role() = 'admin');

-- =========================================================
-- CLIENTES
-- supervisor PODE atualizar (para trocar consultor responsável)
-- =========================================================
DROP POLICY IF EXISTS clientes_select ON public.clientes;
CREATE POLICY clientes_select ON public.clientes FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','consult','supervisor')
  OR cnpj = public.fn_current_cnpj()
);

DROP POLICY IF EXISTS clientes_update ON public.clientes;
CREATE POLICY clientes_update ON public.clientes FOR UPDATE TO authenticated
  USING      (public.fn_current_role() IN ('admin','supervisor','consult'))
  WITH CHECK (public.fn_current_role() IN ('admin','supervisor','consult'));

DROP POLICY IF EXISTS clientes_insert ON public.clientes;
CREATE POLICY clientes_insert ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (public.fn_current_role() IN ('admin','consult'));

DROP POLICY IF EXISTS clientes_delete ON public.clientes;
CREATE POLICY clientes_delete ON public.clientes FOR DELETE TO authenticated
  USING (public.fn_current_role() = 'admin');

-- =========================================================
-- PLANILHAS_COLETA
-- supervisor PODE atualizar (para mudar status / atualizado_em)
-- =========================================================
DROP POLICY IF EXISTS planilhas_select ON public.planilhas_coleta;
CREATE POLICY planilhas_select ON public.planilhas_coleta FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','consult','supervisor')
  OR cnpj = public.fn_current_cnpj()
);

DROP POLICY IF EXISTS planilhas_insert ON public.planilhas_coleta;
CREATE POLICY planilhas_insert ON public.planilhas_coleta FOR INSERT TO authenticated
  WITH CHECK (
       public.fn_current_role() IN ('admin','consult')
    OR (public.fn_current_role() = 'client' AND cnpj = public.fn_current_cnpj())
  );

DROP POLICY IF EXISTS planilhas_update ON public.planilhas_coleta;
CREATE POLICY planilhas_update ON public.planilhas_coleta FOR UPDATE TO authenticated
  USING      (public.fn_current_role() IN ('admin','consult','supervisor'))
  WITH CHECK (public.fn_current_role() IN ('admin','consult','supervisor'));

DROP POLICY IF EXISTS planilhas_delete ON public.planilhas_coleta;
CREATE POLICY planilhas_delete ON public.planilhas_coleta FOR DELETE TO authenticated
  USING (public.fn_current_role() = 'admin');

-- =========================================================
-- COMPROVANTES — supervisor apenas leitura
-- =========================================================
DROP POLICY IF EXISTS comprovantes_select ON public.comprovantes;
CREATE POLICY comprovantes_select ON public.comprovantes FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','consult','supervisor')
  OR cnpj = public.fn_current_cnpj()
);

DROP POLICY IF EXISTS comprovantes_insert ON public.comprovantes;
CREATE POLICY comprovantes_insert ON public.comprovantes FOR INSERT TO authenticated
  WITH CHECK (public.fn_current_role() IN ('admin','consult','client'));

DROP POLICY IF EXISTS comprovantes_update ON public.comprovantes;
CREATE POLICY comprovantes_update ON public.comprovantes FOR UPDATE TO authenticated
  USING      (public.fn_current_role() IN ('admin','consult'))
  WITH CHECK (public.fn_current_role() IN ('admin','consult'));

DROP POLICY IF EXISTS comprovantes_delete ON public.comprovantes;
CREATE POLICY comprovantes_delete ON public.comprovantes FOR DELETE TO authenticated
  USING (public.fn_current_role() = 'admin');

-- =========================================================
-- DOCUMENTOS_GERAIS — supervisor apenas leitura
-- =========================================================
DROP POLICY IF EXISTS documentos_gerais_select ON public.documentos_gerais;
CREATE POLICY documentos_gerais_select ON public.documentos_gerais FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','consult','supervisor')
  OR cnpj = public.fn_current_cnpj()
);

DROP POLICY IF EXISTS documentos_gerais_write ON public.documentos_gerais;
CREATE POLICY documentos_gerais_write ON public.documentos_gerais FOR ALL TO authenticated
  USING      (public.fn_current_role() IN ('admin','consult'))
  WITH CHECK (public.fn_current_role() IN ('admin','consult'));

-- =========================================================
-- FUST_FUNTTEL — supervisor apenas leitura
-- =========================================================
DROP POLICY IF EXISTS fust_funttel_select ON public.fust_funttel;
CREATE POLICY fust_funttel_select ON public.fust_funttel FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','consult','supervisor')
  OR cnpj = public.fn_current_cnpj()
);

DROP POLICY IF EXISTS fust_funttel_insert ON public.fust_funttel;
CREATE POLICY fust_funttel_insert ON public.fust_funttel FOR INSERT TO authenticated
  WITH CHECK (
       public.fn_current_role() IN ('admin','consult')
    OR (public.fn_current_role() = 'client' AND cnpj = public.fn_current_cnpj())
  );

DROP POLICY IF EXISTS fust_funttel_update ON public.fust_funttel;
CREATE POLICY fust_funttel_update ON public.fust_funttel FOR UPDATE TO authenticated
  USING      (public.fn_current_role() IN ('admin','consult'))
  WITH CHECK (public.fn_current_role() IN ('admin','consult'));

DROP POLICY IF EXISTS fust_funttel_delete ON public.fust_funttel;
CREATE POLICY fust_funttel_delete ON public.fust_funttel FOR DELETE TO authenticated
  USING (public.fn_current_role() = 'admin');

-- =========================================================
-- FUST_FUNTTEL_BOLETOS — supervisor apenas leitura
-- =========================================================
DROP POLICY IF EXISTS fust_funttel_boletos_select ON public.fust_funttel_boletos;
CREATE POLICY fust_funttel_boletos_select ON public.fust_funttel_boletos FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','consult','supervisor')
  OR cnpj = public.fn_current_cnpj()
);

DROP POLICY IF EXISTS fust_funttel_boletos_write ON public.fust_funttel_boletos;
CREATE POLICY fust_funttel_boletos_write ON public.fust_funttel_boletos FOR ALL TO authenticated
  USING      (public.fn_current_role() IN ('admin','consult'))
  WITH CHECK (public.fn_current_role() IN ('admin','consult'));

-- =========================================================
-- FIM
-- =========================================================
