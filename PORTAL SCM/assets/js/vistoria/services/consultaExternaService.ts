// ── Avaliação do Simples Nacional ─────────────────────────────────
// A BrasilAPI/Receita já devolve a opção pelo Simples no próprio
// payload do CNPJ (opcao_pelo_simples + datas). Então a verificação
// "optante / não optante" é feita aqui, no cliente, sem backend nem
// proxy. A Edge Function fica reservada para consultas que a BrasilAPI
// NÃO cobre (ex.: 2ª via, parcelamentos).

import type { Empresa } from "../types";
import { dataCurta } from "../config/vistoriaConfig";

export interface ResultadoConsulta {
  status: string; // rótulo compatível com statusRules
  detalhe: string;
  fonte: string;
  automatica: boolean;
}

// Avalia o Simples a partir dos dados já carregados da empresa.
export function avaliarSimples(empresa: Empresa): ResultadoConsulta {
  const { opcaoPeloSimples, dataExclusaoSimples, dataOpcaoSimples, opcaoPeloMei } = empresa;
  const fonte = "BrasilAPI / Receita Federal";

  // Excluído do Simples (tem data de exclusão) → não optante.
  if (dataExclusaoSimples) {
    return {
      status: "Não optante",
      detalhe: `Excluído do Simples em ${dataCurta(dataExclusaoSimples)}.`,
      fonte,
      automatica: true,
    };
  }

  if (opcaoPeloSimples === true) {
    const mei = opcaoPeloMei ? " (também optante pelo MEI)" : "";
    return {
      status: "Optante",
      detalhe: `Optante pelo Simples${
        dataOpcaoSimples ? ` desde ${dataCurta(dataOpcaoSimples)}` : ""
      }${mei}.`,
      fonte,
      automatica: true,
    };
  }

  if (opcaoPeloSimples === false) {
    return {
      status: "Não optante",
      detalhe: "Não optante pelo Simples Nacional.",
      fonte,
      automatica: true,
    };
  }

  // null/indefinido → Receita não informou.
  return {
    status: "Erro/Inconclusivo",
    detalhe: "A Receita não informou a opção pelo Simples. Confira manualmente.",
    fonte,
    automatica: false,
  };
}
