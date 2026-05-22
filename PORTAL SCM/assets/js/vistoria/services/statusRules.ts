// ── Motor central de regras de status ─────────────────────────────
// Toda classificação de cor, cálculo de progresso e identificação de
// pendências críticas passa por aqui. Os componentes nunca decidem cor
// sozinhos — sempre perguntam para classificarStatus().

import type { StatusCor, VistoriaItens, ItemEstado, ResumoVistoria } from "../types";

// Registro canônico: rótulo (em minúsculas) -> categoria de cor.
const REGISTRO: Record<string, StatusCor> = {
  // ── Verde (regular / resolvido) ──────────────────────────────
  regular: "verde",
  ativo: "verde",
  ativa: "verde",
  habilitado: "verde",
  "sem pendências": "verde",
  "sem pendencias": "verde",
  "sem processo em aberto": "verde",
  quitado: "verde",
  emitido: "verde",
  finalizado: "verde",
  "comprovante anexado": "verde",
  optante: "verde",
  "não optante": "verde",
  "nao optante": "verde",

  // ── Amarelo (atenção / em curso / inconclusivo) ──────────────
  atenção: "amarelo",
  atencao: "amarelo",
  processando: "amarelo",
  "em pagamento": "amarelo",
  "a vencer": "amarelo",
  "consulta inconclusiva": "amarelo",
  "verificar manualmente": "amarelo",
  "erro/inconclusivo": "amarelo",
  "pendente/inconclusivo": "amarelo",

  // ── Vermelho (irregular / pendência aberta) ──────────────────
  irregular: "vermelho",
  inativo: "vermelho",
  inativa: "vermelho",
  pendente: "vermelho",
  "em aberto": "vermelho",
  "não habilitado": "vermelho",
  "nao habilitado": "vermelho",
  "com processo em aberto": "vermelho",
  "boleto em aberto": "vermelho",
  "fust e funttel": "vermelho",
  condecine: "vermelho",
  "cfrp e tff": "vermelho",
  "cadastro de estação pendente": "vermelho",
  "cadastro de estacao pendente": "vermelho",
  "cadastro de conta pendente": "vermelho",
  "procuração no sei externo ausente": "vermelho",
  "procuracao no sei externo ausente": "vermelho",
  erro: "vermelho",

  // ── Cinza (neutro / não aplicável) ───────────────────────────
  "não consultado": "cinza",
  "nao consultado": "cinza",
  "não se aplica": "cinza",
  "nao se aplica": "cinza",
  inalterado: "cinza",
  consultando: "cinza",
  aguardando: "cinza",
};

// Classifica qualquer rótulo de status em uma das 4 cores.
export function classificarStatus(label?: string): StatusCor {
  if (!label) return "cinza";
  return REGISTRO[label.trim().toLowerCase()] ?? "cinza";
}

// Status neutros que NÃO entram no cálculo de progresso/score.
const NEUTROS = new Set<StatusCor>(["cinza"]);

const ehConferido = (e: ItemEstado): boolean =>
  classificarStatus(e.status) !== "cinza" || e.status?.toLowerCase() === "inalterado";

// Calcula o percentual de conclusão da vistoria (itens conferidos / total).
export function calcularPercentual(itens: VistoriaItens): number {
  const valores = Object.values(itens);
  if (valores.length === 0) return 0;
  const conferidos = valores.filter(ehConferido).length;
  return Math.round((conferidos / valores.length) * 100);
}

// Pendências críticas = itens classificados como vermelho.
export function identificarPendenciasCriticas(
  itens: VistoriaItens,
  nomes: Record<string, string> = {}
): string[] {
  return Object.entries(itens)
    .filter(([, e]) => classificarStatus(e.status) === "vermelho")
    .map(([id, e]) => `${nomes[id] ?? id}: ${e.status}`);
}

// Gera o resumo completo usado no card de Relatório Final.
export function gerarResumoPendencias(
  itens: VistoriaItens,
  nomes: Record<string, string> = {}
): ResumoVistoria {
  const entradas = Object.entries(itens);
  const total = entradas.length;

  const pendencias = entradas
    .map(([id, e]) => ({
      item: nomes[id] ?? id,
      status: e.status,
      cor: classificarStatus(e.status),
    }))
    .filter((p) => p.cor === "vermelho" || p.cor === "amarelo");

  const totalRegulares = entradas.filter(
    ([, e]) => classificarStatus(e.status) === "verde"
  ).length;
  const totalNaoConsultados = entradas.filter(
    ([, e]) => !ehConferido(e)
  ).length;
  const pendenciasCriticas = identificarPendenciasCriticas(itens, nomes);
  const totalPendencias = pendencias.length;

  let statusGeral: ResumoVistoria["statusGeral"] = "Em andamento";
  if (totalNaoConsultados > 0) statusGeral = "Em andamento";
  else if (pendenciasCriticas.length > 0) statusGeral = "Pendências críticas";
  else if (totalPendencias > 0) statusGeral = "Atenção";
  else statusGeral = "Regular";

  return {
    totalItens: total,
    totalRegulares,
    totalPendencias,
    totalNaoConsultados,
    pendenciasCriticas,
    pendencias,
    percentual: calcularPercentual(itens),
    statusGeral,
  };
}
