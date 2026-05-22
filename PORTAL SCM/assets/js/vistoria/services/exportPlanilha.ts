// ── Exportação da planilha de consulta em lote ────────────────────
// Gera CSV (download, abre no Excel pt-BR) e TSV (copiar e colar
// direto nas células do Excel). As colunas usam os mesmos nomes do
// SharePoint, com status e data de cada coleta + FENINFRA.

import type { LinhaLote } from "./loteService";

interface ColunaDef {
  titulo: string;
  get: (l: LinhaLote) => string;
}

// Coluna que lê um campo da seção "Envio das Coletas de dados"
// (pelo nome exato da coluna no SharePoint).
const colColeta = (label: string): ColunaDef => ({
  titulo: label,
  get: (l) => l.coleta[label] ?? "",
});

export const COLUNAS: ColunaDef[] = [
  { titulo: "Razão Social", get: (l) => l.razaoSocial },
  { titulo: "CNPJ", get: (l) => l.cnpj },
  { titulo: "Situação do CNPJ", get: (l) => l.situacaoCNPJ },

  // ── Envio das Coletas de dados (status + data por serviço) ─────
  colColeta("Status SCM"),
  colColeta("Data Status SCM"),
  colColeta("Status SEAC"),
  colColeta("Data Status SEAC"),
  colColeta("Status STFC"),
  colColeta("Data Status STFC"),
  colColeta("Status Econômico-Financeiro"),
  colColeta("Data Status Econômico-Financeiro"),
  colColeta("Status Infraestrutura de Transporte"),
  colColeta("Data Status Infraestrutura de Transporte"),
  colColeta("Status Infraestrutura de Contratos de Uso de Postes"),
  colColeta("Data Status Infraestrutura de Contratos de Uso de Postes"),
  colColeta("Status FENINFRA"),
  colColeta("Data Status FENINFRA"),
  colColeta("Login FENINFRA"),

  // ── Demais conferências (manuais por enquanto) ─────────────────
  { titulo: "Nada Consta", get: (l) => l.nadaConsta },
  { titulo: "Simples Nacional", get: (l) => l.simples },
  { titulo: "Cartão CNPJ", get: (l) => l.cartaoCNPJ },
  { titulo: "Inscrição Estadual (Situação Cadastral)", get: (l) => l.inscricaoEstadual },
  { titulo: "Situação no Mosaico", get: (l) => l.mosaico },
  { titulo: "Situação no SEI", get: (l) => l.sei },
  { titulo: "Observação", get: (l) => l.erro },
];

// ── CSV (separador ";", com BOM UTF-8 p/ acentos no Excel) ─────────
function escaparCSV(s: string): string {
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function paraCSV(linhas: LinhaLote[]): string {
  const head = COLUNAS.map((c) => escaparCSV(c.titulo)).join(";");
  const corpo = linhas.map((l) =>
    COLUNAS.map((c) => escaparCSV(c.get(l))).join(";")
  );
  return "﻿" + [head, ...corpo].join("\r\n");
}

// ── TSV (para colar direto nas células do Excel) ──────────────────
const limpaTSV = (s: string): string => s.replace(/[\t\n\r]/g, " ").trim();

export function paraTSV(linhas: LinhaLote[]): string {
  const head = COLUNAS.map((c) => limpaTSV(c.titulo)).join("\t");
  const corpo = linhas.map((l) =>
    COLUNAS.map((c) => limpaTSV(c.get(l))).join("\t")
  );
  return [head, ...corpo].join("\n");
}

// Dispara o download de um arquivo de texto.
export function baixarArquivo(conteudo: string, nome: string, tipo: string): void {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function baixarCSV(linhas: LinhaLote[]): void {
  const data = new Date().toISOString().slice(0, 10);
  baixarArquivo(paraCSV(linhas), `vistoria-lote-${data}.csv`, "text/csv;charset=utf-8");
}
