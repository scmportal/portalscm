// ── Persistência de vistorias ─────────────────────────────────────
// Salva/lista vistorias no Supabase quando configurado; caso contrário
// usa localStorage. A assinatura é a mesma, então a UI não muda.

import type { VistoriaSalva } from "../types";
import { supabase, supabaseAtivo } from "./supabaseClient";

// Re-exporta o gerador de resumo (centralizado em statusRules).
export { gerarResumoPendencias } from "./statusRules";

const STORAGE_KEY = "scm_vistorias";

function lerLocal(): VistoriaSalva[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function gravarLocal(lista: VistoriaSalva[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
}

// Salva (insere ou atualiza) uma vistoria.
export async function salvarVistoria(v: VistoriaSalva): Promise<VistoriaSalva> {
  const registro: VistoriaSalva = { ...v, atualizadoEm: new Date().toISOString() };

  if (supabaseAtivo() && supabase) {
    // Persistência no banco real (tabelas do schema.sql).
    const { error } = await supabase.from("vistorias").upsert({
      id: registro.id,
      cnpj: registro.cnpj,
      razao_social: registro.razaoSocial,
      consultor_id: registro.consultor,
      status_geral: registro.resumo.statusGeral,
      percentual_conclusao: registro.resumo.percentual,
      total_pendencias: registro.resumo.totalPendencias,
      total_regulares: registro.resumo.totalRegulares,
      observacoes: registro.observacoes,
      relatorio_gerado: JSON.stringify(registro),
      atualizado_em: registro.atualizadoEm,
    });
    if (error) throw new Error(`Erro ao salvar no Supabase: ${error.message}`);
    return registro;
  }

  // Fallback local.
  const lista = lerLocal();
  const idx = lista.findIndex((x) => x.id === registro.id);
  if (idx >= 0) lista[idx] = registro;
  else lista.unshift(registro);
  gravarLocal(lista);
  return registro;
}

// Lista as vistorias salvas (mais recentes primeiro).
export async function listarVistorias(): Promise<VistoriaSalva[]> {
  if (supabaseAtivo() && supabase) {
    const { data, error } = await supabase
      .from("vistorias")
      .select("relatorio_gerado")
      .order("atualizado_em", { ascending: false });
    if (error) throw new Error(error.message);
    return (data || [])
      .map((r) => {
        try {
          return JSON.parse((r as { relatorio_gerado: string }).relatorio_gerado) as VistoriaSalva;
        } catch {
          return null;
        }
      })
      .filter((x): x is VistoriaSalva => x !== null);
  }
  return lerLocal();
}
