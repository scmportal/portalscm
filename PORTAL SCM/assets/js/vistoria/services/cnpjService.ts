// ── Serviço de consulta de CNPJ ───────────────────────────────────
// Consulta dados públicos da empresa via BrasilAPI (Receita Federal).
// Retorna um objeto Empresa já normalizado para a UI.

import type { Empresa } from "../types";
import { soDigitos } from "../config/vistoriaConfig";

// Em DEV usamos o proxy do Vite (/brasilapi) para evitar CORS e bloqueio
// por extensões; em produção chamamos a BrasilAPI diretamente.
const API_BRASILAPI = (cnpj: string) =>
  import.meta.env.DEV
    ? `/brasilapi/api/cnpj/v1/${cnpj}`
    : `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;

// Resposta crua da BrasilAPI (apenas os campos que usamos).
interface BrasilAPICNPJ {
  cnpj: string;
  razao_social?: string;
  nome_fantasia?: string;
  descricao_situacao_cadastral?: string;
  situacao_cadastral?: number | string;
  uf?: string;
  municipio?: string;
  cnae_fiscal?: number | string;
  cnae_fiscal_descricao?: string;
  natureza_juridica?: string;
  porte?: string;
  capital_social?: number | string;
  data_inicio_atividade?: string;
  email?: string;
  ddd_telefone_1?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  qsa?: { nome_socio?: string; qualificacao_socio?: string }[];
  opcao_pelo_simples?: boolean | null;
  data_opcao_pelo_simples?: string | null;
  data_exclusao_do_simples?: string | null;
  opcao_pelo_mei?: boolean | null;
}

function normalizar(d: BrasilAPICNPJ): Empresa {
  const situacao = (d.descricao_situacao_cadastral || "").toUpperCase();
  const endereco = d.logradouro
    ? `${d.logradouro}, ${d.numero || "s/n"} — ${d.bairro || ""}`.trim()
    : "";
  return {
    cnpj: soDigitos(d.cnpj || ""),
    razaoSocial: d.razao_social || "",
    nomeFantasia: d.nome_fantasia || "",
    situacaoCadastral: situacao || "—",
    ativa: situacao === "ATIVA",
    uf: d.uf || "",
    municipio: d.municipio || "",
    cnae: d.cnae_fiscal ? String(d.cnae_fiscal) : "",
    cnaeDescricao: d.cnae_fiscal_descricao || "",
    naturezaJuridica: d.natureza_juridica || "",
    porte: d.porte || "",
    capitalSocial: Number(d.capital_social || 0),
    dataAbertura: d.data_inicio_atividade || "",
    email: d.email || "",
    telefone: d.ddd_telefone_1 || "",
    endereco,
    cep: d.cep || "",
    socios: (d.qsa || []).map((s) => ({
      nome: s.nome_socio || "",
      qualificacao: s.qualificacao_socio || "",
    })),
    opcaoPeloSimples:
      d.opcao_pelo_simples === undefined ? null : d.opcao_pelo_simples,
    dataOpcaoSimples: d.data_opcao_pelo_simples || undefined,
    dataExclusaoSimples: d.data_exclusao_do_simples || undefined,
    opcaoPeloMei: d.opcao_pelo_mei === undefined ? null : d.opcao_pelo_mei,
  };
}

export async function buscarDadosCNPJ(cnpjInput: string): Promise<Empresa> {
  const raw = soDigitos(cnpjInput);
  if (raw.length !== 14) {
    throw new Error("CNPJ inválido — precisa ter 14 dígitos.");
  }
  const res = await fetch(API_BRASILAPI(raw));
  if (!res.ok) {
    if (res.status === 404) throw new Error("CNPJ não encontrado na Receita.");
    throw new Error(`Falha na consulta (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as BrasilAPICNPJ;
  return normalizar(data);
}
