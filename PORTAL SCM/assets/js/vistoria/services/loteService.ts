// ── Consulta em lote ──────────────────────────────────────────────
// Recebe vários CNPJs e devolve uma linha por CNPJ pronta para a
// planilha. Preenche o que é automatizável agora:
//   • BrasilAPI: Razão Social, Situação do CNPJ, Simples Nacional.
//   • SharePoint (Graph): toda a seção "Envio das Coletas de dados"
//     (status + data de cada serviço + FENINFRA), usando os nomes
//     exatos das colunas da lista Regulamentação.
// O resto (Nada Consta, IE, Mosaico, SEI) fica em branco para
// preenchimento manual.

import { buscarDadosCNPJ } from "./cnpjService";
import { avaliarSimples } from "./consultaExternaService";
import { graphConfigurado, buscarClienteGraph } from "./sharepointGraph";
import { msalConfigurado, obterTokenGraph, PRECISA_CONECTAR } from "./msalAuth";
import { soDigitos, fmtCNPJ } from "../config/vistoriaConfig";

export interface LinhaLote {
  razaoSocial: string;
  cnpj: string;
  situacaoCNPJ: string; // "ATIVA" | "NÃO ATIVA"
  // Mapa nome-da-coluna-SharePoint -> valor (status e datas das coletas).
  coleta: Record<string, string>;
  nadaConsta: string;
  simples: string;
  cartaoCNPJ: string;
  inscricaoEstadual: string;
  mosaico: string;
  sei: string;
  erro: string;
}

export interface ResultadoLote {
  linhas: LinhaLote[];
  spAtivo: boolean; // SharePoint (Graph) configurado e usado
  spErro: string; // mensagem se o login/consulta do SharePoint falhar
}

export const MAX_LOTE = 20;

const linhaVazia = (cnpj: string): LinhaLote => ({
  razaoSocial: "",
  cnpj,
  situacaoCNPJ: "",
  coleta: {},
  nadaConsta: "",
  simples: "",
  cartaoCNPJ: "",
  inscricaoEstadual: "",
  mosaico: "",
  sei: "",
  erro: "",
});

// Extrai CNPJs (14 dígitos) de um texto livre, remove duplicados.
// Aceita um por linha, separados por vírgula, ";" ou espaço.
export function extrairCNPJs(texto: string): string[] {
  const tokens = texto.split(/[\s,;]+/).filter(Boolean);
  const limpos = tokens.map((t) => soDigitos(t)).filter((d) => d.length === 14);
  return [...new Set(limpos)];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProgressoLote {
  feito: number;
  total: number;
  atual: string;
}

// Consulta uma lista de CNPJs sequencialmente (rate-limited).
export async function consultarLote(
  cnpjs: string[],
  onProgress?: (p: ProgressoLote) => void
): Promise<ResultadoLote> {
  const lista = cnpjs.map(soDigitos).filter((d) => d.length === 14).slice(0, MAX_LOTE);

  // Autentica no SharePoint UMA vez (token reaproveitado por todos).
  const usarGraph = graphConfigurado() && msalConfigurado();
  let token: string | null = null;
  let spErro = "";
  if (usarGraph) {
    try {
      token = await obterTokenGraph();
      console.info("[Lote] Token SharePoint obtido.");
    } catch (e) {
      spErro =
        (e as Error).message === PRECISA_CONECTAR
          ? "Clique em “🔌 Conectar ao SharePoint” (topo da tela) antes de consultar."
          : `Login do SharePoint falhou: ${(e as Error).message}`;
      console.warn("[Lote]", spErro);
    }
  } else {
    spErro = "SharePoint não configurado (.env VITE_SP_* / VITE_MSAL_*).";
  }

  const linhas: LinhaLote[] = [];
  for (let i = 0; i < lista.length; i++) {
    const raw = lista[i];
    const linha = linhaVazia(fmtCNPJ(raw));
    onProgress?.({ feito: i, total: lista.length, atual: fmtCNPJ(raw) });

    // 1) BrasilAPI (sempre).
    try {
      const empresa = await buscarDadosCNPJ(raw);
      linha.razaoSocial = empresa.razaoSocial;
      linha.situacaoCNPJ = empresa.ativa ? "ATIVA" : "NÃO ATIVA";
      linha.cartaoCNPJ = empresa.situacaoCadastral;
      const simples = avaliarSimples(empresa);
      linha.simples = simples.automatica ? simples.status : "";
    } catch (e) {
      linha.erro = (e as Error).message;
    }

    // 2) SharePoint (coletas), se autenticado.
    if (token) {
      try {
        const cli = await buscarClienteGraph(raw, token);
        for (const { label, valor } of cli?.coletaDetalhada ?? [])
          linha.coleta[label] = valor;
        console.info(`[Lote] ${raw}: coletas carregadas.`);
      } catch (e) {
        linha.erro = linha.erro || (e as Error).message;
        console.warn(`[Lote] ${raw}: ${(e as Error).message}`);
      }
    }

    linhas.push(linha);
    if (i < lista.length - 1) await delay(300);
  }

  onProgress?.({ feito: lista.length, total: lista.length, atual: "" });
  return { linhas, spAtivo: usarGraph, spErro };
}
