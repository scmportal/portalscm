// ── Tela de Consulta em Lote ──────────────────────────────────────
// Cola até 20 CNPJs, consulta todos de uma vez (BrasilAPI + SharePoint)
// e gera a planilha com status e data de cada coleta. Baixa CSV ou
// copia TSV para colar no Excel.

import { useMemo, useState } from "react";
import type { LinhaLote, ProgressoLote } from "../../services/loteService";
import { consultarLote, extrairCNPJs, MAX_LOTE } from "../../services/loteService";
import { COLUNAS, paraTSV, baixarCSV } from "../../services/exportPlanilha";
import { C, fonteMono, fonteSans } from "../../theme";
import Btn from "../ui/Btn";
import StatusBadge from "../ui/StatusBadge";

const ehStatus = (titulo: string) => /^status|simples|situa|cart|nada/i.test(titulo);

export default function LoteConsulta() {
  // Preserva os CNPJs digitados caso o login redirecione a página.
  const [texto, setTexto] = useState(() => sessionStorage.getItem("lote_cnpjs") ?? "");
  const [linhas, setLinhas] = useState<LinhaLote[]>([]);
  const [rodando, setRodando] = useState(false);
  const [prog, setProg] = useState<ProgressoLote | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [spErro, setSpErro] = useState("");
  const [spAtivo, setSpAtivo] = useState(false);

  const cnpjs = useMemo(() => extrairCNPJs(texto), [texto]);
  const excedeu = cnpjs.length > MAX_LOTE;

  const rodar = async () => {
    if (cnpjs.length === 0 || rodando) return;
    setRodando(true);
    setLinhas([]);
    setSpErro("");
    setProg({ feito: 0, total: Math.min(cnpjs.length, MAX_LOTE), atual: "" });
    const res = await consultarLote(cnpjs, setProg);
    setLinhas(res.linhas);
    setSpErro(res.spErro);
    setSpAtivo(res.spAtivo);
    setRodando(false);
  };

  const copiarTSV = async () => {
    try {
      await navigator.clipboard.writeText(paraTSV(linhas));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div style={{ fontFamily: fonteSans, fontSize: 13, color: C.text, padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Consulta em lote</div>
        <div style={{ fontSize: 12, color: C.muted }}>
          Cole os CNPJs (um por linha ou separados por vírgula). Máximo de{" "}
          {MAX_LOTE} por vez.
        </div>
      </div>

      <textarea
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          sessionStorage.setItem("lote_cnpjs", e.target.value);
        }}
        placeholder={"56.009.391/0001-60\n09.503.359/0001-56\n..."}
        disabled={rodando}
        style={{
          width: "100%",
          minHeight: 110,
          padding: "8px 10px",
          border: `0.5px solid ${C.border}`,
          borderRadius: 7,
          fontSize: 12,
          fontFamily: fonteMono,
          resize: "vertical",
          boxSizing: "border-box",
          outline: "none",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 0" }}>
        <Btn primary onClick={rodar} disabled={rodando || cnpjs.length === 0 || excedeu}>
          {rodando ? "⏳ Consultando..." : `🔍 Consultar ${cnpjs.length} CNPJ(s)`}
        </Btn>
        <span style={{ fontSize: 12, color: excedeu ? C.err : C.muted }}>
          {cnpjs.length} CNPJ(s) válido(s) detectado(s)
          {excedeu && ` — reduza para no máximo ${MAX_LOTE}.`}
        </span>
      </div>

      <div style={{ background: C.infoBg, color: C.infoTxt, borderRadius: 7, padding: "8px 10px", fontSize: 11, marginBottom: 12 }}>
        ℹ️ <strong>Razão Social, CNPJ, Situação do CNPJ, Simples Nacional</strong> vêm da Receita (BrasilAPI).
        Os <strong>status e datas das coletas + FENINFRA</strong> vêm do SharePoint. Nada Consta, IE, Mosaico
        e SEI ficam em branco para preenchimento manual.
      </div>

      {/* Aviso do SharePoint após consulta */}
      {linhas.length > 0 && (
        <div
          style={{
            background: spErro ? C.warnBg : C.okBg,
            color: spErro ? C.warn : C.ok,
            borderRadius: 7,
            padding: "8px 10px",
            fontSize: 11,
            marginBottom: 12,
          }}
        >
          {spErro
            ? `⚠️ Coletas não preenchidas — ${spErro}`
            : spAtivo
            ? "✅ Coletas carregadas do SharePoint (Microsoft Graph)."
            : "ℹ️ SharePoint inativo — colunas de coleta em branco."}
        </div>
      )}

      {/* Progresso */}
      {prog && rodando && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>
            {prog.feito}/{prog.total} {prog.atual && `— consultando ${prog.atual}`}
          </div>
          <div style={{ height: 6, background: C.grayBg, borderRadius: 99 }}>
            <div
              style={{
                height: "100%",
                width: `${prog.total ? (prog.feito / prog.total) * 100 : 0}%`,
                background: C.brand,
                borderRadius: 99,
                transition: "width 0.2s",
              }}
            />
          </div>
        </div>
      )}

      {/* Resultado */}
      {linhas.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <Btn primary sm onClick={() => baixarCSV(linhas)}>
              ⬇️ Baixar planilha (CSV)
            </Btn>
            <Btn sm onClick={copiarTSV}>
              {copiado ? "✅ Copiado!" : "📋 Copiar para colar no Excel"}
            </Btn>
            <span style={{ fontSize: 11, color: C.muted, alignSelf: "center" }}>
              {linhas.length} linha(s) gerada(s)
            </span>
          </div>

          <div style={{ overflowX: "auto", border: `0.5px solid ${C.border}`, borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: 1200 }}>
              <thead>
                <tr style={{ background: C.surface2 }}>
                  {COLUNAS.map((c) => (
                    <th
                      key={c.titulo}
                      style={{
                        padding: "6px 8px",
                        textAlign: "left",
                        color: C.muted,
                        borderBottom: `0.5px solid ${C.border}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} style={{ borderBottom: `0.5px solid ${C.border}`, background: l.erro ? C.errBg : undefined }}>
                    {COLUNAS.map((c) => {
                      const v = c.get(l);
                      return (
                        <td key={c.titulo} style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                          {c.titulo === "Razão Social" && l.erro ? (
                            `⚠️ ${l.razaoSocial || l.erro}`
                          ) : v ? (
                            ehStatus(c.titulo) ? <StatusBadge label={v} pequeno /> : v
                          ) : (
                            <span style={{ color: C.border }}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
