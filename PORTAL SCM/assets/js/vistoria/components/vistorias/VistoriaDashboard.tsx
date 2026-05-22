// ── VistoriaDashboard — orquestrador da tela ──────────────────────
// Controla o estado vivo da vistoria (itens, empresa, SharePoint, logs)
// e compõe todos os cards. A lógica de status/resumo vem dos services.

import { useMemo, useReducer, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type {
  Empresa,
  VistoriaItens,
  ItemEstado,
  LogEntry,
  SharePointCliente,
  ColetaSharePoint,
  VistoriaSalva,
} from "../../types";
import {
  CARDS_MANUAIS,
  CONSULTOR_PADRAO,
  CNPJ_DEMO,
  inputCNPJ,
  fmtCNPJ,
  cnpjValido,
  fmt,
  horaCurta,
  agora,
} from "../../config/vistoriaConfig";
import { C, fonteMono, fonteSans } from "../../theme";
import { buscarDadosCNPJ } from "../../services/cnpjService";
import {
  sincronizarCartaoCliente,
  buscarStatusColetas,
  derivarColetas,
} from "../../services/sharepointService";
import { graphConfigurado, buscarClienteGraph } from "../../services/sharepointGraph";
import { msalConfigurado, obterTokenGraph, PRECISA_CONECTAR } from "../../services/msalAuth";
import { gerarResumoPendencias } from "../../services/statusRules";
import { avaliarSimples } from "../../services/consultaExternaService";
import { salvarVistoria } from "../../services/vistoriaService";

import Btn from "../ui/Btn";
import StatusBadge from "../ui/StatusBadge";
import CartaoCNPJCard from "./CartaoCNPJCard";
import SharePointCard from "./SharePointCard";
import ColetasAnatelCard from "./ColetasAnatelCard";
import SimplesNacionalCard from "./SimplesNacionalCard";
import VistoriaCard from "./VistoriaCard";
import ObservacoesCard from "./ObservacoesCard";
import RelatorioFinalCard from "./RelatorioFinalCard";
import LogVistoria from "./LogVistoria";

// ── Itens fixos (além dos config-driven) ──────────────────────────
const ITEM_CARTAO = "cartao_cnpj";
const ITEM_SIMPLES = "simples";
const ITEM_COLETAS = "coletas";

// Mapa id -> nome legível (para o resumo / relatório).
const NOMES_ITENS: Record<string, string> = {
  [ITEM_CARTAO]: "Cartão CNPJ",
  [ITEM_SIMPLES]: "Simples Nacional",
  [ITEM_COLETAS]: "Coletas ANATEL",
};
CARDS_MANUAIS.forEach((card) =>
  card.subitens.forEach((s) => {
    NOMES_ITENS[s.id] = `${card.categoria} · ${s.nome}`;
  })
);

function seedItens(): VistoriaItens {
  const itens: VistoriaItens = {
    [ITEM_CARTAO]: { status: "Não consultado", manual: false },
    [ITEM_SIMPLES]: { status: "Não consultado", manual: false },
    [ITEM_COLETAS]: { status: "Não consultado", manual: false },
  };
  CARDS_MANUAIS.forEach((card) =>
    card.subitens.forEach((s) => {
      itens[s.id] = { status: s.statusPadrao, manual: false };
    })
  );
  return itens;
}

// Reducer do estado dos itens.
type Action =
  | { type: "patch"; id: string; patch: Partial<ItemEstado> }
  | { type: "reset" };

function reducer(state: VistoriaItens, action: Action): VistoriaItens {
  switch (action.type) {
    case "patch":
      return {
        ...state,
        [action.id]: { ...(state[action.id] ?? { status: "Não consultado", manual: false }), ...action.patch },
      };
    case "reset":
      return seedItens();
    default:
      return state;
  }
}

export default function VistoriaDashboard() {
  const [cnpjInput, setCnpjInput] = useState(CNPJ_DEMO);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [loadingCNPJ, setLoadingCNPJ] = useState(false);
  const [cartaoDataConsulta, setCartaoDataConsulta] = useState<string>();

  const [itens, dispatch] = useReducer(reducer, undefined, seedItens);
  const [observacoes, setObservacoes] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [sharepoint, setSharepoint] = useState<SharePointCliente | null>(null);
  const [coletas, setColetas] = useState<ColetaSharePoint[]>([]);
  const [coletaPendencias, setColetaPendencias] = useState<string[]>([]);
  const [loadingSP, setLoadingSP] = useState(false);
  const [avisoSP, setAvisoSP] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [travado, setTravado] = useState(false);

  const addLog = useCallback((msg: string, cor: string = C.brand) => {
    const iso = agora();
    setLogs((prev) => [{ msg, cor, iso, time: horaCurta(iso) }, ...prev].slice(0, 30));
  }, []);

  const setItem = useCallback(
    (id: string, patch: Partial<ItemEstado>) => dispatch({ type: "patch", id, patch }),
    []
  );

  // ── Buscar CNPJ ─────────────────────────────────────────────────
  const buscarCNPJ = useCallback(async () => {
    if (!cnpjValido(cnpjInput)) {
      addLog("❌ CNPJ inválido — precisa ter 14 dígitos.", C.err);
      return;
    }
    setLoadingCNPJ(true);
    setEmpresa(null);
    dispatch({ type: "reset" });
    setSharepoint(null);
    setColetas([]);
    setColetaPendencias([]);
    setTravado(false);
    addLog(`Consultando CNPJ ${fmtCNPJ(cnpjInput)} na BrasilAPI / Receita Federal...`);
    try {
      const dados = await buscarDadosCNPJ(cnpjInput);
      setEmpresa(dados);
      const dt = agora();
      setCartaoDataConsulta(dt);
      // Define automaticamente o status do Cartão CNPJ.
      setItem(ITEM_CARTAO, {
        status: dados.ativa ? "Regular" : "Irregular",
        manual: false,
        fonte: "BrasilAPI / Receita Federal",
        dataConsulta: dt,
      });
      addLog(`✅ Dados carregados: ${dados.razaoSocial}`, C.ok);
      if (!dados.ativa) {
        addLog(`⚠️ Situação cadastral: ${dados.situacaoCadastral}`, C.warn);
      }
      // Pré-preenche o Simples Nacional com o dado oficial da Receita.
      const simples = avaliarSimples(dados);
      setItem(ITEM_SIMPLES, {
        status: simples.status,
        resultado: simples.detalhe,
        fonte: simples.fonte,
        manual: !simples.automatica,
        dataConsulta: dt,
      });
      addLog(`⚡ Simples Nacional: ${simples.status}`, simples.automatica ? C.ok : C.warn);
    } catch (e) {
      addLog(`❌ ${(e as Error).message}`, C.err);
    } finally {
      setLoadingCNPJ(false);
    }
  }, [cnpjInput, addLog, setItem]);

  // ── Sincronizar SharePoint ──────────────────────────────────────
  const sincronizarSP = useCallback(async () => {
    if (!empresa) return;
    setLoadingSP(true);
    setAvisoSP("");
    const usarGraph = graphConfigurado() && msalConfigurado();
    addLog(
      usarGraph
        ? "Conectando ao SharePoint (Microsoft Graph)..."
        : "Sincronizando cartão do cliente (modo simulado)..."
    );
    try {
      let cli: SharePointCliente | null = null;
      if (usarGraph) {
        const token = await obterTokenGraph();
        cli = await buscarClienteGraph(empresa.cnpj, token);
        if (!cli) {
          const msg = "Empresa não encontrada na lista de Regulamentação.";
          setAvisoSP(msg);
          addLog(`⚠️ ${msg}`, C.warn);
          setLoadingSP(false);
          return;
        }
        cli.ultimaSincronizacao = agora();
      } else {
        cli = await sincronizarCartaoCliente(empresa.cnpj);
      }
      setSharepoint(cli);
      const { coletas: cs, pendencias } = cli
        ? derivarColetas(cli)
        : await buscarStatusColetas(empresa.cnpj);
      setColetas(cs);
      setColetaPendencias(pendencias);
      setItem(ITEM_COLETAS, {
        status: pendencias.length > 0 ? "Pendente" : "Sem pendências",
        manual: false,
        fonte: "SharePoint / Microsoft Lists",
        dataConsulta: agora(),
        observacao: pendencias.join("; "),
      });
      // Pré-preenche FISTEL/login no card FENINFRA, se disponível.
      if (cli?.fistel) setItem("feninfra_atesto", { fistel: cli.fistel, loginFeninfra: cli.loginFeninfra });
      addLog(
        pendencias.length > 0
          ? `⚠️ SharePoint sincronizado — ${pendencias.length} pendência(s) nas coletas`
          : "✅ SharePoint sincronizado — sem pendências nas coletas",
        pendencias.length > 0 ? C.warn : C.ok
      );
    } catch (e) {
      const msg =
        (e as Error).message === PRECISA_CONECTAR
          ? "Clique em “🔌 Conectar ao SharePoint” (topo da tela) antes de sincronizar."
          : (e as Error).message;
      setAvisoSP(msg);
      addLog(`⚠️ ${msg}`, C.warn);
    } finally {
      setLoadingSP(false);
    }
  }, [empresa, addLog, setItem]);

  // ── Resumo (memorizado) ─────────────────────────────────────────
  const resumo = useMemo(
    () => gerarResumoPendencias(itens, NOMES_ITENS),
    [itens]
  );

  // ── Texto do relatório (copiar / PDF) ───────────────────────────
  const gerarTexto = useCallback((): string => {
    const linhas: string[] = [];
    linhas.push("RELATÓRIO DE VISTORIA — SCM VISTORIAS");
    linhas.push("=".repeat(48));
    linhas.push(`Empresa: ${empresa?.razaoSocial ?? "—"}`);
    linhas.push(`CNPJ: ${empresa ? fmtCNPJ(empresa.cnpj) : "—"}`);
    linhas.push(`Situação cadastral: ${empresa?.situacaoCadastral ?? "—"}`);
    linhas.push(`Consultor: ${CONSULTOR_PADRAO}`);
    linhas.push(`Data: ${new Date().toLocaleString("pt-BR")}`);
    linhas.push(`Status geral: ${resumo.statusGeral} (${resumo.percentual}% concluído)`);
    linhas.push("");
    linhas.push("ITENS CONFERIDOS");
    linhas.push("-".repeat(48));
    Object.entries(itens).forEach(([id, e]) => {
      linhas.push(`• ${NOMES_ITENS[id] ?? id}: ${e.status}`);
    });
    if (resumo.pendenciasCriticas.length > 0) {
      linhas.push("");
      linhas.push("PENDÊNCIAS CRÍTICAS");
      linhas.push("-".repeat(48));
      resumo.pendenciasCriticas.forEach((p) => linhas.push(`! ${p}`));
    }
    if (observacoes.trim()) {
      linhas.push("");
      linhas.push("OBSERVAÇÕES");
      linhas.push("-".repeat(48));
      linhas.push(observacoes.trim());
    }
    return linhas.join("\n");
  }, [empresa, itens, observacoes, resumo]);

  // ── Salvar vistoria ─────────────────────────────────────────────
  const salvar = useCallback(async () => {
    if (!empresa) return;
    if (travado) {
      addLog("ℹ️ Vistoria já salva. Clique em 'Editar' para alterar.", C.gray);
      return;
    }
    setSalvando(true);
    try {
      const registro: VistoriaSalva = {
        id: `${empresa.cnpj}-${Date.now()}`,
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        consultor: CONSULTOR_PADRAO,
        empresa,
        itens,
        observacoes,
        resumo,
        logs,
        criadoEm: agora(),
        atualizadoEm: agora(),
      };
      await salvarVistoria(registro);
      setTravado(true);
      addLog("💾 Vistoria salva com sucesso.", C.ok);
    } catch (e) {
      addLog(`❌ Erro ao salvar: ${(e as Error).message}`, C.err);
    } finally {
      setSalvando(false);
    }
  }, [empresa, itens, observacoes, resumo, logs, travado, addLog]);

  const cardProps = { itens, setItem, travado, addLog };

  return (
    <div style={{ fontFamily: fonteSans, fontSize: 13, color: C.text }}>
      {/* ── Topbar ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: C.brand,
          borderRadius: "12px 12px 0 0",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            background: C.white,
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: C.brand,
          }}
        >
          SCM
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.white }}>SCM Vistorias</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
            Sistema de Vistorias Regulatórias
          </div>
        </div>
        {empresa && (
          <div
            style={{
              background: "rgba(255,255,255,0.15)",
              color: C.white,
              padding: "4px 12px",
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {resumo.percentual}% concluído
          </div>
        )}
      </div>

      {/* ── Barra de progresso ─────────────────────────────────── */}
      {empresa && (
        <div style={{ height: 4, background: C.grayBg }}>
          <div
            style={{
              height: "100%",
              width: `${resumo.percentual}%`,
              background:
                resumo.percentual >= 80 ? C.ok : resumo.percentual >= 40 ? C.warn : C.err,
              transition: "width 0.3s",
            }}
          />
        </div>
      )}

      {/* ── Busca CNPJ ─────────────────────────────────────────── */}
      <div
        style={{
          background: C.infoBg,
          borderBottom: `0.5px solid ${C.border}`,
          padding: "14px 16px",
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              color: C.infoTxt,
              fontWeight: 600,
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            CNPJ da empresa
          </div>
          <input
            value={cnpjInput}
            onChange={(e) => setCnpjInput(inputCNPJ(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && buscarCNPJ()}
            placeholder="00.000.000/0001-00"
            style={{
              height: 34,
              padding: "0 12px",
              border: `1.5px solid ${C.brand}`,
              borderRadius: 7,
              fontSize: 14,
              fontFamily: fonteMono,
              background: C.white,
              color: C.text,
              width: 210,
              outline: "none",
            }}
          />
        </div>
        <Btn primary onClick={buscarCNPJ} disabled={loadingCNPJ}>
          {loadingCNPJ ? "⏳ Buscando..." : "🔍 Buscar empresa"}
        </Btn>
        {empresa && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <StatusBadge label={resumo.statusGeral} />
            {travado && (
              <Btn sm onClick={() => { setTravado(false); addLog("✏️ Edição reaberta.", C.gray); }}>
                ✏️ Editar
              </Btn>
            )}
          </div>
        )}
      </div>

      {/* ── Banner de dados da empresa ─────────────────────────── */}
      {empresa && (
        <div
          style={{
            background: C.white,
            borderLeft: `3px solid ${C.brand}`,
            borderBottom: `0.5px solid ${C.border}`,
            padding: "12px 16px",
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <Campo label="Razão Social" valor={fmt(empresa.razaoSocial)} forte sub={empresa.nomeFantasia} />
          <Campo label="CNPJ" valor={fmtCNPJ(empresa.cnpj)} mono />
          <div>
            <Rotulo>Situação</Rotulo>
            <StatusBadge label={empresa.ativa ? "Ativa" : empresa.situacaoCadastral} />
          </div>
          <Campo label="UF / Município" valor={`${fmt(empresa.uf)} — ${fmt(empresa.municipio)}`} />
          <Campo
            label="CNAE Principal"
            valor={`${empresa.cnae} — ${empresa.cnaeDescricao.slice(0, 40)}`}
          />
        </div>
      )}

      {/* ── Cards ──────────────────────────────────────────────── */}
      {empresa ? (
        <div
          style={{
            padding: 16,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 12,
            background: C.surface2,
          }}
        >
          <CartaoCNPJCard empresa={empresa} dataConsulta={cartaoDataConsulta} />
          <SharePointCard
            cliente={sharepoint}
            loading={loadingSP}
            pendencias={coletaPendencias}
            aviso={avisoSP}
            onSincronizar={sincronizarSP}
          />
          <ColetasAnatelCard
            coletas={coletas}
            loading={loadingSP}
            pendencias={coletaPendencias}
            detalhado={sharepoint?.coletaDetalhada}
          />
          <SimplesNacionalCard empresa={empresa} {...cardProps} />
          {CARDS_MANUAIS.map((cfg) => (
            <VistoriaCard key={cfg.id} config={cfg} {...cardProps} />
          ))}
          <ObservacoesCard value={observacoes} onChange={setObservacoes} disabled={travado} />
          <RelatorioFinalCard
            resumo={resumo}
            empresa={empresa}
            observacoes={observacoes}
            salvando={salvando}
            travado={travado}
            onSalvar={salvar}
            gerarTexto={gerarTexto}
          />
          <LogVistoria logs={logs} />
        </div>
      ) : (
        !loadingCNPJ && (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, background: C.surface2 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🏢</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              Digite um CNPJ e clique em buscar
            </div>
            <div style={{ fontSize: 12 }}>
              O sistema consulta a Receita Federal (BrasilAPI) e pré-preenche a vistoria.
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
              <Btn primary onClick={buscarCNPJ}>
                🔍 Buscar {CNPJ_DEMO}
              </Btn>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── Pequenos helpers de layout do banner ──────────────────────────
const Rotulo = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      fontSize: 10,
      color: C.muted,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    }}
  >
    {children}
  </div>
);

const Campo = ({
  label,
  valor,
  forte,
  mono,
  sub,
}: {
  label: string;
  valor: string;
  forte?: boolean;
  mono?: boolean;
  sub?: string;
}) => (
  <div>
    <Rotulo>{label}</Rotulo>
    <div
      style={{
        fontWeight: forte ? 700 : 500,
        fontSize: forte ? 14 : 13,
        fontFamily: mono ? fonteMono : "inherit",
      }}
    >
      {valor}
    </div>
    {sub && <div style={{ fontSize: 11, color: C.muted }}>{sub}</div>}
  </div>
);
