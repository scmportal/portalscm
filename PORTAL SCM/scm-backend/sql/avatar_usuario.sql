-- =========================================================
-- AVATAR DO USUÁRIO (galeria de personagens)
-- =========================================================
-- Objetivo:
--   Permitir que CONSULTOR e SUPERVISOR escolham um avatar (emoji-personagem)
--   que aparece no lugar das iniciais na barra lateral.
--
--   Como a policy de UPDATE de public.usuarios só permite admin
--   (ver supervisor.sql -> usuarios_update_admin), usamos uma função
--   SECURITY DEFINER que atualiza SOMENTE a coluna avatar do próprio
--   usuário logado — sem expor as demais colunas (role, nome, etc).
--
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.
-- Pré-requisito: rodar antes os arquivos supervisor.sql e
--                permissoes_consultor_supervisor.sql (helpers de role/id).
-- =========================================================

ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS avatar text;

-- Atualiza SOMENTE o avatar do próprio usuário logado.
CREATE OR REPLACE FUNCTION public.fn_atualizar_meu_avatar(p_avatar text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- só consultor/supervisor podem alterar o avatar
  IF public.fn_current_role() NOT IN ('consult','supervisor') THEN
    RAISE EXCEPTION 'Apenas consultor/supervisor podem alterar o avatar.';
  END IF;

  -- guarda simples de tamanho (armazenamos só o caractere do emoji)
  IF p_avatar IS NOT NULL AND length(p_avatar) > 32 THEN
    RAISE EXCEPTION 'Avatar inválido.';
  END IF;

  -- p_avatar = NULL limpa o avatar (volta às iniciais)
  UPDATE public.usuarios
     SET avatar = p_avatar
   WHERE id::text = public.fn_current_user_id();
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_atualizar_meu_avatar(text) TO authenticated;

-- =========================================================
-- FIM
-- =========================================================
