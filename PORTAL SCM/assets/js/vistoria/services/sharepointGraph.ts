// ── Integração REAL com a lista do SharePoint (Microsoft Graph) ───
// Auto-configurável: o app lê as COLUNAS da lista e descobre sozinho
// o nome interno de cada uma a partir do nome visível ("Status SCM",
// "CNPJ s/ Form."...). Assim não é preciso mapear nomes na mão.
//
// Pré-requisitos no .env (ver docs/INTEGRACAO_SHAREPOINT.md):
//   VITE_SP_SITE_ID, VITE_SP_LIST_ID  (+ login MSAL configurado).

import type { SharePointCliente } from "../types";
import { soDigitos } from "../config/vistoriaConfig";

const SITE_ID = import.meta.env.VITE_SP_SITE_ID as string | undefined;
const LIST_ID = import.meta.env.VITE_SP_LIST_ID as string | undefined;

export const graphConfigurado = (): boolean => Boolean(SITE_ID && LIST_ID);

const BASE = () =>
  `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/lists/${LIST_ID}`;

// Fetch ao Graph que, em caso de erro, traz a MENSAGEM real do Graph
// (não só o código HTTP), facilitando o diagnóstico.
async function graphGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let detalhe = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detalhe = j?.error?.message ?? "";
    } catch {
      /* sem corpo */
    }
    throw new Error(`Graph HTTP ${res.status}${detalhe ? ` — ${detalhe}` : ""}`);
  }
  return res.json() as Promise<T>;
}

interface Coluna {
  name: string; // nome interno (usado pelo Graph)
  displayName: string; // nome visível na tela
}

let colunasCache: Coluna[] | null = null;

// Normaliza para comparar nomes ignorando acentos/espaços/maiúsculas.
// Remove marcas de acento (faixa Unicode 0x300–0x36F) sem depender de
// caractere especial no código-fonte.
const norm = (s: string): string => {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x300 && code <= 0x36f) continue;
    out += ch;
  }
  return out.toLowerCase().replace(/[^a-z0-9]/g, "");
};

// Acha o nome interno da coluna cujo nome visível contém TODOS os termos.
// Em empate, prefere o nome mais curto (ex.: "Status SCM" vence
// "Data Status SCM" para os termos status+scm).
function achar(cols: Coluna[], ...termos: string[]): string | undefined {
  const alvos = termos.map(norm);
  const cand = cols
    .filter((c) => c.displayName && alvos.every((a) => norm(c.displayName).includes(a)))
    .sort((a, b) => norm(a.displayName).length - norm(b.displayName).length);
  return cand[0]?.name;
}

// Acha o nome interno pelo nome visível EXATO (ignorando acento/caixa).
function acharExato(cols: Coluna[], displayName: string): string | undefined {
  const alvo = norm(displayName);
  return cols.find((c) => norm(c.displayName) === alvo)?.name;
}

// Campos da seção "Envio das Coletas de dados" (na ordem do SharePoint).
export const CAMPOS_COLETA: string[] = [
  "SCM zerado",
  "SEAC zerado",
  "STFC zerado",
  "Status SCM",
  "Data Status SCM",
  "Data envio de comprovante SCM",
  "Status SEAC",
  "Data Status SEAC",
  "Data envio comprovante SEAC",
  "Status STFC",
  "Data Status STFC",
  "Data envio comprovante STFC",
  "Status Econômico-Financeiro",
  "Data Status Econômico-Financeiro",
  "Data envio de comprovante Econômico-Financeiro",
  "Status Infraestrutura de Transporte",
  "Data Status Infraestrutura de Transporte",
  "Data Envio de Comprovante de Infraestrutura de Transporte",
  "Status Estações Infra",
  "Status Enlaces Próprios Infra",
  "Status Enlaces Contratados Infra",
  "Status Infraestrutura de Contratos de Uso de Postes",
  "Data Status Infraestrutura de Contratos de Uso de Postes",
  "Data Envio de Comprovante de Infraestrutura de Contrato de Uso de Postes",
  "Status FENINFRA",
  "Data Status FENINFRA",
  "Login FENINFRA",
  "Status Fluxo PA",
];

// Formata datas ISO (Graph) para dd/mm/aaaa; demais valores passam direto.
function fmtValor(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleDateString("pt-BR");
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  return s;
}

async function carregarColunas(token: string): Promise<Coluna[]> {
  if (colunasCache) return colunasCache;
  // Sem $select (alguns ambientes rejeitam com 400). Mapeamos os
  // campos name/displayName a partir da resposta completa.
  const json = await graphGet<{ value?: Coluna[] }>(`${BASE()}/columns`, token);
  colunasCache = (json.value ?? []).filter((c) => c.displayName);
  // Ajuda no diagnóstico: nomes detectados aparecem no console (F12).
  console.info(
    "[SharePoint] Colunas detectadas:",
    colunasCache.map((c) => c.displayName)
  );
  return colunasCache;
}

type ItemGraph = { id: string; fields: Record<string, unknown> };
let itensCache: ItemGraph[] | null = null;

// Monta o $select com os nomes internos das colunas que usamos —
// reduz MUITO o payload e permite carregar a lista inteira.
function selectFields(cols: Coluna[]): string {
  const nomes = new Set<string>(["id"]);
  const add = (n?: string) => {
    if (n) nomes.add(n);
  };
  add(cols.find((c) => norm(c.displayName) === "cnpj")?.name);
  add(achar(cols, "cnpj", "form"));
  add(achar(cols, "razao", "social"));
  add(achar(cols, "fistel"));
  add(achar(cols, "consultor"));
  for (const label of CAMPOS_COLETA) add(acharExato(cols, label));
  return [...nomes].join(",");
}

type PaginaItens = { value?: ItemGraph[]; "@odata.nextLink"?: string };

async function paginar(token: string, expandir: string): Promise<ItemGraph[]> {
  const todos: ItemGraph[] = [];
  let url: string | null = `${BASE()}/items?$top=500&expand=${expandir}`;
  for (let pagina = 0; pagina < 200 && url; pagina++) {
    const json: PaginaItens = await graphGet<PaginaItens>(url, token);
    todos.push(...(json.value ?? []));
    url = json["@odata.nextLink"] ?? null;
  }
  return todos;
}

// Carrega TODOS os itens da lista (paginado) e guarda em cache na sessão.
// Tenta com $select (leve); se falhar, recarrega com todos os campos.
async function carregarItens(token: string, cols: Coluna[]): Promise<ItemGraph[]> {
  if (itensCache) return itensCache;
  let itens: ItemGraph[];
  try {
    itens = await paginar(token, `fields($select=${selectFields(cols)})`);
  } catch (e) {
    console.warn("[SharePoint] $select falhou, recarregando campos completos:", e);
    itens = await paginar(token, "fields");
  }
  itensCache = itens;
  console.info(`[SharePoint] ${itens.length} itens carregados da lista.`);
  return itens;
}

// Extrai apenas os dígitos de um valor (texto, número ou objeto link).
function digitosDe(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return soDigitos(JSON.stringify(v));
  return soDigitos(String(v));
}

// Limpa o cache (forçar recarga na próxima sincronização).
export function limparCacheSharePoint(): void {
  itensCache = null;
  colunasCache = null;
}

// Busca o item cujo CNPJ corresponde — fazendo o match no cliente.
export async function buscarClienteGraph(
  cnpj: string,
  token: string
): Promise<SharePointCliente | null> {
  if (!graphConfigurado()) {
    throw new Error("Integração Graph não configurada (.env VITE_SP_*).");
  }
  const raw = soDigitos(cnpj);
  const cols = await carregarColunas(token);
  const itens = await carregarItens(token, cols);

  const item = itens.find((it) =>
    // Match robusto: qualquer campo cujos dígitos contenham o CNPJ.
    Object.values(it.fields).some((v) => digitosDe(v).includes(raw))
  );

  if (!item) {
    throw new Error(
      `Empresa não encontrada na lista de Regulamentação (${itens.length} itens lidos).`
    );
  }
  return mapear(raw, item.id, item.fields, cols);
}

// Mapeia os campos do item para o nosso modelo usando os nomes visíveis.
function mapear(
  cnpj: string,
  id: string,
  fields: Record<string, unknown>,
  cols: Coluna[]
): SharePointCliente {
  const ler = (...termos: string[]): string | undefined => {
    const nome = achar(cols, ...termos);
    const v = nome ? fields[nome] : undefined;
    return v == null || v === "" ? undefined : String(v);
  };

  const statusFeninfra = ler("status", "feninfra") ?? ler("atesto", "feninfra");

  // Seção "Envio das Coletas de dados" — todos os campos por nome exato.
  const coletaDetalhada = CAMPOS_COLETA.map((label) => {
    const nome = acharExato(cols, label);
    return { label, valor: nome ? fmtValor(fields[nome]) : "" };
  });

  return {
    coletaDetalhada,
    cnpj,
    razaoSocial: ler("razao", "social") ?? String(fields["Title"] ?? ""),
    simulado: false,
    itemId: Number(id),
    fistel: ler("fistel"),
    loginFeninfra: ler("login", "feninfra"),
    consultor: ler("consultor"),
    ultimaSincronizacao: new Date().toISOString(),
    statusSCM: ler("status", "scm"),
    statusSeAC: ler("status", "seac"),
    statusSTFC: ler("status", "stfc"),
    statusEconomicoFinanceiro: ler("status", "economico"),
    statusInfraTransporte: ler("status", "infraestrutura", "transporte") ?? ler("status", "infra"),
    statusInfraPostes: ler("status", "postes") ?? ler("status", "uso"),
    statusFeninfra,
    atestoFeninfraEmitido: (ler("atesto", "feninfra") ?? statusFeninfra ?? "")
      .toLowerCase()
      .includes("emitid"),
    dataStatusSCM: ler("data", "status", "scm"),
    dataComprovanteSCM: ler("data", "comprovante", "scm"),
    dataStatusSeAC: ler("data", "status", "seac"),
    dataComprovanteSeAC: ler("data", "comprovante", "seac"),
    dataStatusSTFC: ler("data", "status", "stfc"),
    dataComprovanteSTFC: ler("data", "comprovante", "stfc"),
    dataStatusFeninfra: ler("data", "status", "feninfra"),
  };
}
