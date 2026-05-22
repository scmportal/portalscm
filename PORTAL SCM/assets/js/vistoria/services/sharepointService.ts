// ── Serviço SharePoint / Microsoft Lists (cartão do cliente) ──────
// Camada preparada para integração real com o SharePoint da SCM.
// Hoje retorna dados MOCKADOS; quando a integração via Microsoft Graph
// /Supabase Edge Function existir, basta trocar o corpo das funções.
//
// Lista de origem (produção):
//   https://scmprovedor.sharepoint.com/sites/GestaoIntegrada/Lists/Regulamentacao

import type {
  SharePointCliente,
  ColetasAnatel,
  ColetaSharePoint,
} from "../types";
import { soDigitos, agora } from "../config/vistoriaConfig";
import { classificarStatus } from "./statusRules";

// ── Base mockada (substituir por chamada real ao Graph/Edge) ──────
const MOCK: Record<string, SharePointCliente> = {
  "56009391000160": {
    cnpj: "56009391000160",
    razaoSocial: "PROVEDOR DEMO SCM LTDA",
    fistel: "50409876543",
    loginFeninfra: "provedordemo",
    consultor: "Cauã Brito",
    ultimaSincronizacao: "2026-05-10T13:30:00.000Z",
    statusSCM: "Finalizado",
    statusSeAC: "Não se aplica",
    statusSTFC: "Pendente",
    statusEconomicoFinanceiro: "Finalizado",
    statusInfraTransporte: "Processando",
    statusInfraPostes: "Finalizado",
    statusFeninfra: "Emitido",
    atestoFeninfraEmitido: true,
    dataStatusSCM: "2026-03-31",
    dataComprovanteSCM: "2026-04-02",
    dataStatusSeAC: "—",
    dataStatusSTFC: "2026-03-31",
    dataComprovanteSTFC: "",
    dataStatusEconomicoFinanceiro: "2026-04-30",
    dataComprovanteEconomicoFinanceiro: "2026-05-02",
    dataStatusInfra: "2026-04-15",
    dataComprovanteInfra: "",
    dataStatusFeninfra: "2026-02-20",
  },
};

// Pequeno atraso para simular I/O de rede.
const delay = (ms = 450) => new Promise((r) => setTimeout(r, ms));

// Hash determinístico simples a partir dos dígitos do CNPJ.
function semente(cnpj: string): number {
  return soDigitos(cnpj)
    .split("")
    .reduce((a, c) => a + Number(c), 0);
}

const escolher = <T,>(arr: T[], s: number) => arr[s % arr.length];

// Gera um cartão SIMULADO porém ESTÁVEL (mesmo CNPJ => mesmo resultado).
// Usado enquanto a integração real do SharePoint não está configurada.
function gerarClienteSimulado(cnpj: string): SharePointCliente {
  const s = semente(cnpj);
  const stColeta = ["Finalizado", "Processando", "Pendente"];
  return {
    cnpj,
    razaoSocial: "",
    simulado: true,
    fistel: `504${String(s).padStart(8, "0").slice(0, 8)}`,
    loginFeninfra: `cliente${cnpj.slice(0, 5)}`,
    consultor: "Cauã Brito",
    ultimaSincronizacao: undefined,
    statusSCM: escolher(stColeta, s),
    statusSeAC: escolher([...stColeta, "Não se aplica"], s + 1),
    statusSTFC: escolher([...stColeta, "Não se aplica"], s + 2),
    statusEconomicoFinanceiro: escolher(stColeta, s + 3),
    statusInfraTransporte: escolher(stColeta, s + 4),
    statusInfraPostes: escolher(stColeta, s + 5),
    statusFeninfra: escolher(["Emitido", "Pendente"], s),
    atestoFeninfraEmitido: s % 2 === 0,
    dataStatusSCM: "2026-03-31",
    dataStatusSTFC: "2026-03-31",
    dataStatusFeninfra: "2026-02-20",
  };
}

// Busca o cartão do cliente no SharePoint pelo CNPJ.
export async function buscarClienteSharePoint(
  cnpj: string
): Promise<SharePointCliente | null> {
  await delay();
  const raw = soDigitos(cnpj);
  return MOCK[raw] ?? gerarClienteSimulado(raw);
}

// Deriva a lista de coletas ANATEL a partir de um cartão de cliente
// (serve tanto para o mock quanto para o dado real do Graph).
export function derivarColetas(cli: SharePointCliente): ColetasAnatel {
  const coletas: ColetaSharePoint[] = [
    { nome: "SCM", status: cli.statusSCM || "Não consultado", dataStatus: cli.dataStatusSCM, dataComprovante: cli.dataComprovanteSCM },
    { nome: "SeAC", status: cli.statusSeAC || "Não consultado", dataStatus: cli.dataStatusSeAC, dataComprovante: cli.dataComprovanteSeAC },
    { nome: "STFC", status: cli.statusSTFC || "Não consultado", dataStatus: cli.dataStatusSTFC, dataComprovante: cli.dataComprovanteSTFC },
    { nome: "Econômico-Financeiro", status: cli.statusEconomicoFinanceiro || "Não consultado", dataStatus: cli.dataStatusEconomicoFinanceiro, dataComprovante: cli.dataComprovanteEconomicoFinanceiro },
    { nome: "Infraestrutura de Transporte", status: cli.statusInfraTransporte || "Não consultado", dataStatus: cli.dataStatusInfra, dataComprovante: cli.dataComprovanteInfra },
    { nome: "Contratos de Uso de Postes", status: cli.statusInfraPostes || "Não consultado", dataStatus: cli.dataStatusInfra, dataComprovante: cli.dataComprovanteInfra },
  ];

  // Pendência = qualquer coleta que não esteja verde nem cinza.
  const pendencias = coletas
    .filter((c) => classificarStatus(c.status) === "vermelho" || classificarStatus(c.status) === "amarelo")
    .map((c) => `${c.nome}: ${c.status}`);

  return { coletas, pendencias };
}

// Versão por CNPJ (busca o cartão e deriva as coletas).
export async function buscarStatusColetas(cnpj: string): Promise<ColetasAnatel> {
  const cli =
    (await buscarClienteSharePoint(cnpj)) ?? gerarClienteSimulado(soDigitos(cnpj));
  return derivarColetas(cli);
}

// Dados específicos do FENINFRA (FISTEL, login, atesto).
export async function buscarDadosFeninfra(cnpj: string): Promise<{
  fistel?: string;
  loginFeninfra?: string;
  atestoEmitido: boolean;
  statusFeninfra: string;
}> {
  const cli = (await buscarClienteSharePoint(cnpj)) ?? gerarClienteSimulado(soDigitos(cnpj));
  return {
    fistel: cli.fistel,
    loginFeninfra: cli.loginFeninfra,
    atestoEmitido: Boolean(cli.atestoFeninfraEmitido),
    statusFeninfra: cli.statusFeninfra || "Não consultado",
  };
}

// Sincroniza (re-busca) o cartão e atualiza o timestamp.
export async function sincronizarCartaoCliente(
  cnpj: string
): Promise<SharePointCliente | null> {
  const cli = await buscarClienteSharePoint(cnpj);
  if (cli) cli.ultimaSincronizacao = agora();
  return cli;
}
