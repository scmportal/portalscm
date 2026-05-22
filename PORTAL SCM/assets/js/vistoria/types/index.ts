// ── Tipos compartilhados do sistema de vistorias ──────────────────

import type { StatusCor } from "../theme";

export type { StatusCor };

// Dados normalizados da empresa (saída do cnpjService).
export interface Empresa {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  situacaoCadastral: string; // ex.: "ATIVA"
  ativa: boolean;
  uf: string;
  municipio: string;
  cnae: string;
  cnaeDescricao: string;
  naturezaJuridica: string;
  porte: string;
  capitalSocial: number;
  dataAbertura: string;
  email: string;
  telefone: string;
  endereco: string;
  cep: string;
  socios: { nome: string; qualificacao: string }[];
  fistel?: string;
  // Simples Nacional / MEI (vêm da própria BrasilAPI/Receita).
  opcaoPeloSimples: boolean | null;
  dataOpcaoSimples?: string;
  dataExclusaoSimples?: string;
  opcaoPeloMei: boolean | null;
}

// Estado de um item de vistoria (uma linha de status conferida).
export interface ItemEstado {
  status: string;
  resultado?: string;
  numeroProcesso?: string;
  observacao?: string;
  fistel?: string;
  loginFeninfra?: string;
  dataConsulta?: string; // ISO
  fonte?: string;
  manual: boolean;
}

// Mapa id-do-item -> estado. É o "estado vivo" da vistoria.
export type VistoriaItens = Record<string, ItemEstado>;

// Linha de log da vistoria.
export interface LogEntry {
  msg: string;
  time: string;
  cor: string;
  iso: string;
}

// ── SharePoint / Microsoft Lists — cartão do cliente ──────────────
export interface ColetaSharePoint {
  nome: string; // ex.: "SCM", "SeAC", "STFC"...
  status: string; // ex.: "Finalizado", "Pendente", "Processando"
  dataStatus?: string;
  dataComprovante?: string;
}

export interface SharePointCliente {
  cnpj: string;
  razaoSocial: string;
  simulado?: boolean; // true = dado gerado (sem integração real ativa)
  itemId?: number; // ID do item na lista do SharePoint
  // Seção "Envio das Coletas de dados" (todos os campos, na ordem da lista).
  coletaDetalhada?: { label: string; valor: string }[];
  fistel?: string;
  loginFeninfra?: string;
  consultor?: string;
  ultimaSincronizacao?: string;
  // Status macro por serviço (espelham as colunas da lista).
  statusSCM?: string;
  statusSeAC?: string;
  statusSTFC?: string;
  statusEconomicoFinanceiro?: string;
  statusInfraTransporte?: string;
  statusInfraPostes?: string;
  statusFeninfra?: string;
  atestoFeninfraEmitido?: boolean;
  // Datas relevantes.
  dataStatusSCM?: string;
  dataComprovanteSCM?: string;
  dataStatusSeAC?: string;
  dataComprovanteSeAC?: string;
  dataStatusSTFC?: string;
  dataComprovanteSTFC?: string;
  dataStatusEconomicoFinanceiro?: string;
  dataComprovanteEconomicoFinanceiro?: string;
  dataStatusInfra?: string;
  dataComprovanteInfra?: string;
  dataStatusFeninfra?: string;
}

// Coletas ANATEL derivadas do cartão do cliente.
export interface ColetasAnatel {
  coletas: ColetaSharePoint[];
  pendencias: string[];
}

// ── Resumo / relatório final ──────────────────────────────────────
export interface ResumoVistoria {
  totalItens: number;
  totalRegulares: number;
  totalPendencias: number;
  totalNaoConsultados: number;
  pendenciasCriticas: string[];
  pendencias: { item: string; status: string; cor: StatusCor }[];
  percentual: number;
  statusGeral: "Regular" | "Atenção" | "Pendências críticas" | "Em andamento";
}

// Props compartilhadas pelos cards de conferência.
export interface CardComumProps {
  itens: VistoriaItens;
  setItem: (id: string, patch: Partial<ItemEstado>) => void;
  travado: boolean;
  addLog: (msg: string, cor?: string) => void;
}

// ── Persistência (Supabase / localStorage) ────────────────────────
export interface VistoriaSalva {
  id: string;
  cnpj: string;
  razaoSocial: string;
  consultor: string;
  empresa: Empresa | null;
  itens: VistoriaItens;
  observacoes: string;
  resumo: ResumoVistoria;
  logs: LogEntry[];
  criadoEm: string;
  atualizadoEm: string;
}
