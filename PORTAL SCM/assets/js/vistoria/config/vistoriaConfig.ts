// ── Configuração central da vistoria ──────────────────────────────
// Toda a definição de cards manuais, opções de status, campos extras e
// links externos vive aqui. Para adicionar/alterar uma conferência,
// edite este arquivo — os componentes leem tudo daqui.

import type { Empresa } from "../types";

// Consultor padrão (em produção viria do login / Supabase auth).
export const CONSULTOR_PADRAO = "Cauã Brito";

// CNPJ de demonstração usado no estado inicial.
export const CNPJ_DEMO = "56.009.391/0001-60";

// ── Helpers de formatação / validação ─────────────────────────────
export const fmt = (s?: string | number | null): string =>
  s === 0 ? "0" : s ? String(s) : "—";

export const soDigitos = (v: string): string => v.replace(/\D/g, "");

export const fmtCNPJ = (v: string): string => {
  const d = soDigitos(v).slice(0, 14);
  return (
    d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") || "—"
  );
};

// Máscara progressiva enquanto o usuário digita.
export const inputCNPJ = (v: string): string => {
  let d = soDigitos(v).slice(0, 14);
  d = d.replace(/^(\d{2})(\d)/, "$1.$2");
  d = d.replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3");
  d = d.replace(/\.(\d{3})(\d)/, ".$1/$2");
  d = d.replace(/(\d{4})(\d)/, "$1-$2");
  return d;
};

export const cnpjValido = (v: string): boolean => soDigitos(v).length === 14;

export const agora = (): string => new Date().toISOString();

export const horaCurta = (iso?: string): string =>
  (iso ? new Date(iso) : new Date()).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export const dataCurta = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

// ── Links externos (consulta manual) ──────────────────────────────
export const LINKS = {
  cartaoCNPJ: "https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/",
  simples: "https://consopt.www8.receita.fazenda.gov.br/consultaoptantes",
  inscricaoEstadual: "https://www.consultaie.com.br/",
  ancine:
    "https://sad2.ancine.gov.br/sacs/cobrancasContribuinte/acessarCobrancasContribuinte.seam",
  seiPublico:
    "https://sei.anatel.gov.br/sei/modulos/pesquisa/md_pesq_processo_pesquisar.php",
  nadaConsta:
    "https://sistemas.anatel.gov.br/boleto/NadaConsta/tela.asp?SISQSmodulo=8427",
  mosaico:
    "https://sistemas.anatel.gov.br/se/tlist?cfg=CadastroEstacaoExt&ctx=FISTELE",
  coleta: "https://apps.anatel.gov.br/ColetaDados/ColetasConsultaExterno.aspx",
  crea: "https://servicos.sinceti.net.br/index.php",
  sharepoint:
    "https://scmprovedor.sharepoint.com/sites/GestaoIntegrada/Lists/Regulamentacao/AllItems.aspx",
} as const;

// ── Campos extras que um card manual pode exibir ──────────────────
export type CampoExtraKey =
  | "numeroProcesso"
  | "observacao"
  | "fistel"
  | "loginFeninfra"
  | "resultado";

export interface CampoExtra {
  key: CampoExtraKey;
  label: string;
  placeholder?: string;
}

export interface SubItemConfig {
  id: string;
  nome: string;
  statusOptions: string[];
  statusPadrao: string;
}

export interface CardManualConfig {
  id: string;
  categoria: string;
  titulo: string;
  icon: string;
  descricao?: string;
  link?: string;
  linkLabel?: string;
  // Necessita FISTEL além do CNPJ para a consulta (ex.: ANCINE).
  precisaFistel?: boolean;
  // Lista de status conferidos no card (1 ou mais).
  subitens: SubItemConfig[];
  campos?: CampoExtra[];
  // Apenas obrigatório em janeiro/junho (regra de negócio).
  obrigatorioJanJun?: boolean;
}

const STATUS_BASE_OBS: CampoExtra = {
  key: "observacao",
  label: "Observação",
  placeholder: "Anotações da conferência...",
};

// ── Definição dos cards de conferência manual ─────────────────────
// (Empresa, SharePoint, Coletas, Simples, CREA e Relatório são
//  componentes dedicados; estes aqui são os config-driven.)
export const CARDS_MANUAIS: CardManualConfig[] = [
  {
    id: "inscricao_estadual",
    categoria: "Inscrição Estadual",
    titulo: "Inscrição Estadual",
    icon: "🗂️",
    descricao:
      "Situação IE deve estar Habilitado. Obrigatória em jan/jun; demais meses registrar Regular.",
    link: LINKS.inscricaoEstadual,
    linkLabel: "🔗 consultaie.com.br",
    obrigatorioJanJun: true,
    subitens: [
      {
        id: "ie_situacao",
        nome: "Situação IE",
        statusOptions: [
          "Habilitado",
          "Não habilitado",
          "Atenção",
          "Não consultado",
        ],
        statusPadrao: "Não consultado",
      },
    ],
    campos: [STATUS_BASE_OBS],
  },
  {
    id: "nada_consta",
    categoria: "Nada Consta ANATEL",
    titulo: "Nada Consta ANATEL",
    icon: "✅",
    descricao: "Verificar pendências de FUST/FUNTTEL, CONDECINE, CFRP e TFF.",
    link: LINKS.nadaConsta,
    linkLabel: "🔗 Nada Consta ANATEL",
    subitens: [
      {
        id: "nada_consta_status",
        nome: "Pendências",
        statusOptions: [
          "Sem pendências",
          "FUST e FUNTTEL",
          "CONDECINE",
          "CFRP e TFF",
          "Pendente/Inconclusivo",
          "Não consultado",
        ],
        statusPadrao: "Não consultado",
      },
    ],
    campos: [STATUS_BASE_OBS],
  },
  {
    id: "mosaico",
    categoria: "Mosaico",
    titulo: "Mosaico ANATEL",
    icon: "📻",
    descricao: "Cadastro de estações e procuração no SEI Externo.",
    link: LINKS.mosaico,
    linkLabel: "🔗 Mosaico ANATEL",
    subitens: [
      {
        id: "mosaico_status",
        nome: "Situação",
        statusOptions: [
          "Sem pendências",
          "Cadastro de estação pendente",
          "Procuração no SEI Externo ausente",
          "Não consultado",
        ],
        statusPadrao: "Não consultado",
      },
    ],
    campos: [STATUS_BASE_OBS],
  },
  {
    id: "sei_publico",
    categoria: "SEI Público ANATEL",
    titulo: "SEI Público ANATEL",
    icon: "⚖️",
    descricao: "Pesquisar processos em aberto pelo CNPJ/Razão Social.",
    link: LINKS.seiPublico,
    linkLabel: "🔗 SEI ANATEL",
    subitens: [
      {
        id: "sei_status",
        nome: "Processos",
        statusOptions: [
          "Sem processo em aberto",
          "Com processo em aberto",
          "Cadastro de conta pendente",
          "Não consultado",
        ],
        statusPadrao: "Não consultado",
      },
    ],
    campos: [
      {
        key: "numeroProcesso",
        label: "Nº do processo",
        placeholder: "Ex: 53500.012345/2026-01",
      },
      STATUS_BASE_OBS,
    ],
  },
  {
    id: "feninfra_condecine",
    categoria: "FENINFRA / ANCINE",
    titulo: "FENINFRA / ANCINE / CONDECINE",
    icon: "📡",
    descricao: "Atesto FENINFRA e cobranças CONDECINE (consulta por CNPJ + FISTEL).",
    link: LINKS.ancine,
    linkLabel: "🔗 ANCINE / CONDECINE",
    precisaFistel: true,
    subitens: [
      {
        id: "feninfra_atesto",
        nome: "Atesto FENINFRA",
        statusOptions: ["Emitido", "Pendente", "Não se aplica", "Não consultado"],
        statusPadrao: "Não consultado",
      },
      {
        id: "condecine_boleto",
        nome: "CONDECINE",
        statusOptions: [
          "Sem pendências",
          "Boleto em aberto",
          "Em pagamento",
          "Não consultado",
        ],
        statusPadrao: "Não consultado",
      },
    ],
    campos: [
      { key: "fistel", label: "FISTEL", placeholder: "Número do FISTEL" },
      {
        key: "loginFeninfra",
        label: "Login FENINFRA",
        placeholder: "Usuário FENINFRA",
      },
      STATUS_BASE_OBS,
    ],
  },
  {
    id: "crea_cft",
    categoria: "CREA / CFT",
    titulo: "CREA / CFT",
    icon: "🛡️",
    descricao: "Responsável técnico, anuidade, CRQ, autos e relatórios.",
    link: LINKS.crea,
    linkLabel: "🔗 SINCETI / CREA",
    subitens: [
      {
        id: "crea_responsavel",
        nome: "Responsável Técnico",
        statusOptions: ["Regular", "Pendente", "Não se aplica", "Não consultado"],
        statusPadrao: "Não consultado",
      },
      {
        id: "crea_anuidade",
        nome: "Anuidade",
        statusOptions: ["Quitado", "A vencer", "Em aberto", "Não consultado"],
        statusPadrao: "Não consultado",
      },
      {
        id: "crea_crq",
        nome: "CRQ",
        statusOptions: ["Regular", "Pendente", "Não se aplica", "Não consultado"],
        statusPadrao: "Não consultado",
      },
      {
        id: "crea_auto_infracao",
        nome: "Auto de Infração",
        statusOptions: ["Sem pendências", "Em aberto", "Não consultado"],
        statusPadrao: "Não consultado",
      },
      {
        id: "crea_relatorio",
        nome: "Relatório de Fiscalização",
        statusOptions: ["Regular", "Pendente", "Não se aplica", "Não consultado"],
        statusPadrao: "Não consultado",
      },
    ],
    campos: [STATUS_BASE_OBS],
  },
];

// Opções do Simples Nacional (card dedicado).
export const SIMPLES_OPTIONS = [
  "Optante",
  "Não optante",
  "Inalterado",
  "Erro/Inconclusivo",
  "Não consultado",
];

// É mês de consulta obrigatória? (janeiro = 0, junho = 5)
export const mesObrigatorio = (d = new Date()): boolean =>
  d.getMonth() === 0 || d.getMonth() === 5;

// Link do cartão CNPJ oficial (a Receita não aceita deep-link por CNPJ).
export const linkCartaoCNPJ = (_e?: Empresa): string => LINKS.cartaoCNPJ;
