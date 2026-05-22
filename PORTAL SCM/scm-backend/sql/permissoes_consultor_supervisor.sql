-- =========================================================
-- PERMISSÕES — Consultor vê só suas empresas + Supervisora gerencia vínculos
-- =========================================================
-- Objetivo:
--   1) Consultor: SELECT apenas em clientes/planilhas/comprovantes/documentos
--      cujo "consultor responsável" (clientes.consultor) é igual ao nome do
--      próprio usuário logado.
--   2) Supervisor: mesmo poder do admin para INSERT/UPDATE/DELETE em
--      clientes (gerenciar vínculo consultor↔empresa).
--   3) Admin: acesso total.
--   4) Client: continua vendo apenas seu próprio CNPJ.
--
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
-- Pré-requisito: rodar antes o arquivo supervisor.sql.
-- =========================================================

-- 1) Helper para descobrir o NOME do usuário logado
CREATE OR REPLACE FUNCTION public.fn_current_user_nome()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT nome FROM public.v_current_user LIMIT 1;
$$;

-- 2) Helper de match consultor↔nome (case-insensitive, trim, sem acentos)
CREATE OR REPLACE FUNCTION public.fn_match_consultor(consultor_text text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    consultor_text IS NOT NULL
    AND public.fn_current_user_nome() IS NOT NULL
    AND lower(btrim(consultor_text)) = lower(btrim(public.fn_current_user_nome()));
$$;

-- =========================================================
-- CLIENTES
-- Consultor: só vê quem está com ele como responsável.
-- Supervisor: pode INSERT/UPDATE/DELETE (gerenciar vínculo) — igual ADMIN.
-- =========================================================
DROP POLICY IF EXISTS clientes_select ON public.clientes;
CREATE POLICY clientes_select ON public.clientes FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','supervisor')
  OR (public.fn_current_role() = 'consult' AND public.fn_match_consultor(consultor))
  OR (public.fn_current_role() = 'client'  AND cnpj = public.fn_current_cnpj())
);

DROP POLICY IF EXISTS clientes_update ON public.clientes;
CREATE POLICY clientes_update ON public.clientes FOR UPDATE TO authenticated
  USING (
       public.fn_current_role() IN ('admin','supervisor')
    OR (public.fn_current_role() = 'consult' AND public.fn_match_consultor(consultor))
  )
  WITH CHECK (
       public.fn_current_role() IN ('admin','supervisor')
    OR (public.fn_current_role() = 'consult' AND public.fn_match_consultor(consultor))
  );

DROP POLICY IF EXISTS clientes_insert ON public.clientes;
CREATE POLICY clientes_insert ON public.clientes FOR INSERT TO authenticated
  WITH CHECK (public.fn_current_role() IN ('admin','supervisor','consult'));

DROP POLICY IF EXISTS clientes_delete ON public.clientes;
CREATE POLICY clientes_delete ON public.clientes FOR DELETE TO authenticated
  USING (public.fn_current_role() IN ('admin','supervisor'));

-- =========================================================
-- PLANILHAS_COLETA
-- Consultor: vê apenas planilhas das empresas que ele atende.
-- =========================================================
DROP POLICY IF EXISTS planilhas_select ON public.planilhas_coleta;
CREATE POLICY planilhas_select ON public.planilhas_coleta FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','supervisor')
  OR (
       public.fn_current_role() = 'consult'
       AND EXISTS (
         SELECT 1
         FROM public.clientes c
         WHERE
           regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(planilhas_coleta.cnpj,''), '[^0-9]', '', 'g')
           AND public.fn_match_consultor(c.consultor)
       )
     )
  OR (public.fn_current_role() = 'client'
      AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
        = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
);

DROP POLICY IF EXISTS planilhas_update ON public.planilhas_coleta;
CREATE POLICY planilhas_update ON public.planilhas_coleta FOR UPDATE TO authenticated
  USING (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(planilhas_coleta.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
    OR (public.fn_current_role() = 'client'
        AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
  )
  WITH CHECK (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(planilhas_coleta.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
    OR (public.fn_current_role() = 'client'
        AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
  );

-- =========================================================
-- COMPROVANTES
-- =========================================================
DROP POLICY IF EXISTS comprovantes_select ON public.comprovantes;
CREATE POLICY comprovantes_select ON public.comprovantes FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','supervisor')
  OR (
       public.fn_current_role() = 'consult'
       AND EXISTS (
         SELECT 1
         FROM public.clientes c
         WHERE
           regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(comprovantes.cnpj,''), '[^0-9]', '', 'g')
           AND public.fn_match_consultor(c.consultor)
       )
     )
  OR (public.fn_current_role() = 'client'
      AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
        = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
);

DROP POLICY IF EXISTS comprovantes_update ON public.comprovantes;
CREATE POLICY comprovantes_update ON public.comprovantes FOR UPDATE TO authenticated
  USING (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(comprovantes.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  )
  WITH CHECK (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(comprovantes.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  );

-- =========================================================
-- DOCUMENTOS_GERAIS
-- =========================================================
DROP POLICY IF EXISTS documentos_gerais_select ON public.documentos_gerais;
CREATE POLICY documentos_gerais_select ON public.documentos_gerais FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','supervisor')
  OR (
       public.fn_current_role() = 'consult'
       AND EXISTS (
         SELECT 1
         FROM public.clientes c
         WHERE
           regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(documentos_gerais.cnpj,''), '[^0-9]', '', 'g')
           AND public.fn_match_consultor(c.consultor)
       )
     )
  OR (public.fn_current_role() = 'client'
      AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
        = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
);

DROP POLICY IF EXISTS documentos_gerais_write ON public.documentos_gerais;
CREATE POLICY documentos_gerais_write ON public.documentos_gerais FOR ALL TO authenticated
  USING (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(documentos_gerais.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  )
  WITH CHECK (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(documentos_gerais.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  );

-- =========================================================
-- FUST_FUNTTEL
-- =========================================================
DROP POLICY IF EXISTS fust_funttel_select ON public.fust_funttel;
CREATE POLICY fust_funttel_select ON public.fust_funttel FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','supervisor')
  OR (
       public.fn_current_role() = 'consult'
       AND EXISTS (
         SELECT 1
         FROM public.clientes c
         WHERE
           regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(fust_funttel.cnpj,''), '[^0-9]', '', 'g')
           AND public.fn_match_consultor(c.consultor)
       )
     )
  OR (public.fn_current_role() = 'client'
      AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
        = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
);

DROP POLICY IF EXISTS fust_funttel_update ON public.fust_funttel;
CREATE POLICY fust_funttel_update ON public.fust_funttel FOR UPDATE TO authenticated
  USING (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(fust_funttel.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  )
  WITH CHECK (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(fust_funttel.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  );

-- =========================================================
-- FUST_FUNTTEL_BOLETOS
-- =========================================================
DROP POLICY IF EXISTS fust_funttel_boletos_select ON public.fust_funttel_boletos;
CREATE POLICY fust_funttel_boletos_select ON public.fust_funttel_boletos FOR SELECT TO authenticated USING (
     public.fn_current_role() IN ('admin','supervisor')
  OR (
       public.fn_current_role() = 'consult'
       AND EXISTS (
         SELECT 1
         FROM public.clientes c
         WHERE
           regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(fust_funttel_boletos.cnpj,''), '[^0-9]', '', 'g')
           AND public.fn_match_consultor(c.consultor)
       )
     )
  OR (public.fn_current_role() = 'client'
      AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
        = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
);

DROP POLICY IF EXISTS fust_funttel_boletos_write ON public.fust_funttel_boletos;
CREATE POLICY fust_funttel_boletos_write ON public.fust_funttel_boletos FOR ALL TO authenticated
  USING (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(fust_funttel_boletos.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  )
  WITH CHECK (
       public.fn_current_role() IN ('admin','supervisor')
    OR (
         public.fn_current_role() = 'consult'
         AND EXISTS (
           SELECT 1
           FROM public.clientes c
           WHERE
             regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
             = regexp_replace(coalesce(fust_funttel_boletos.cnpj,''), '[^0-9]', '', 'g')
             AND public.fn_match_consultor(c.consultor)
         )
       )
  );

-- =========================================================
-- USUARIOS — supervisor pode listar consultores p/ vincular
-- =========================================================
-- (já contemplado em supervisor.sql: usuarios_select inclui supervisor)

-- =========================================================
-- BOLETOS_ANUIDADES — consultor só vê os boletos das empresas que atende
-- =========================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'boletos_anuidades' AND relnamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'ALTER TABLE public.boletos_anuidades ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "boletos_anuidades_select" ON public.boletos_anuidades';
    EXECUTE $POL$
      CREATE POLICY "boletos_anuidades_select"
        ON public.boletos_anuidades FOR SELECT TO authenticated
        USING (
             public.fn_current_role() IN ('admin','supervisor')
          OR (
               public.fn_current_role() = 'consult'
               AND EXISTS (
                 SELECT 1 FROM public.clientes c
                 WHERE regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
                       = regexp_replace(coalesce(boletos_anuidades.cnpj,''), '[^0-9]', '', 'g')
                   AND public.fn_match_consultor(c.consultor)
               )
             )
          OR (public.fn_current_role() = 'client'
              AND regexp_replace(coalesce(cnpj,''), '[^0-9]', '', 'g')
                = regexp_replace(coalesce(public.fn_current_cnpj(),''), '[^0-9]', '', 'g'))
        )
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS "boletos_anuidades_insert" ON public.boletos_anuidades';
    EXECUTE $POL$
      CREATE POLICY "boletos_anuidades_insert"
        ON public.boletos_anuidades FOR INSERT TO authenticated
        WITH CHECK (
             public.fn_current_role() IN ('admin','supervisor')
          OR (
               public.fn_current_role() = 'consult'
               AND EXISTS (
                 SELECT 1 FROM public.clientes c
                 WHERE regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
                       = regexp_replace(coalesce(boletos_anuidades.cnpj,''), '[^0-9]', '', 'g')
                   AND public.fn_match_consultor(c.consultor)
               )
             )
        )
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS "boletos_anuidades_update" ON public.boletos_anuidades';
    EXECUTE $POL$
      CREATE POLICY "boletos_anuidades_update"
        ON public.boletos_anuidades FOR UPDATE TO authenticated
        USING (
             public.fn_current_role() IN ('admin','supervisor')
          OR (
               public.fn_current_role() = 'consult'
               AND EXISTS (
                 SELECT 1 FROM public.clientes c
                 WHERE regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
                       = regexp_replace(coalesce(boletos_anuidades.cnpj,''), '[^0-9]', '', 'g')
                   AND public.fn_match_consultor(c.consultor)
               )
             )
        )
        WITH CHECK (
             public.fn_current_role() IN ('admin','supervisor')
          OR (
               public.fn_current_role() = 'consult'
               AND EXISTS (
                 SELECT 1 FROM public.clientes c
                 WHERE regexp_replace(coalesce(c.cnpj,''), '[^0-9]', '', 'g')
                       = regexp_replace(coalesce(boletos_anuidades.cnpj,''), '[^0-9]', '', 'g')
                   AND public.fn_match_consultor(c.consultor)
               )
             )
        )
    $POL$;

    EXECUTE 'DROP POLICY IF EXISTS "boletos_anuidades_delete" ON public.boletos_anuidades';
    EXECUTE $POL$
      CREATE POLICY "boletos_anuidades_delete"
        ON public.boletos_anuidades FOR DELETE TO authenticated
        USING (public.fn_current_role() IN ('admin','supervisor'))
    $POL$;
  END IF;
END$$;

-- =========================================================
-- FIM
-- =========================================================
