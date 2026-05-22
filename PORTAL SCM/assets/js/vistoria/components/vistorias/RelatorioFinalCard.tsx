// ── Card Relatório Final ──────────────────────────────────────────
// Resume a vistoria: itens regulares, pendências, pendências críticas,
// e oferece salvar / gerar PDF / copiar relatório para o cliente.

import { useState } from "react";
import type { ResumoVistoria, Empresa } from "../../types";
import { COR_BADGE } from "../../theme";
import { C } from "../../theme";
import { dataCurta } from "../../config/vistoriaConfig";
import Card from "../ui/Card";
import Btn from "../ui/Btn";

interface Props {
  resumo: ResumoVistoria;
  empresa: Empresa | null;
  observacoes: string;
  salvando: boolean;
  travado: boolean;
  onSalvar: () => void;
  gerarTexto: () => string;
}

const Metric = ({ n, label, cor }: { n: number; label: string; cor: string }) => (
  <div
    style={{
      flex: 1,
      minWidth: 90,
      background: C.surface2,
      border: `0.5px solid ${C.border}`,
      borderRadius: 8,
      padding: "10px 12px",
      textAlign: "center",
    }}
  >
    <div style={{ fontSize: 22, fontWeight: 700, color: cor }}>{n}</div>
    <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>
      {label}
    </div>
  </div>
);

export default function RelatorioFinalCard({
  resumo,
  empresa,
  salvando,
  travado,
  onSalvar,
  gerarTexto,
}: Props) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(gerarTexto());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  const gerarPDF = () => {
    // Solução simples e dependência-zero: abre janela de impressão do
    // navegador (o usuário escolhe "Salvar como PDF").
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<pre style="font-family:monospace;white-space:pre-wrap;padding:24px">${gerarTexto()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`
    );
    w.document.title = `Vistoria ${empresa?.razaoSocial ?? ""}`;
    w.document.close();
    w.print();
  };

  return (
    <Card title="Relatório Final" icon="📑" badgeLabel={resumo.statusGeral} full>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Metric n={resumo.totalRegulares} label="Regulares" cor={C.ok} />
        <Metric n={resumo.totalPendencias} label="Pendências" cor={C.warn} />
        <Metric n={resumo.pendenciasCriticas.length} label="Críticas" cor={C.err} />
        <Metric n={resumo.totalNaoConsultados} label="Não consultados" cor={C.gray} />
        <Metric n={resumo.percentual} label="% concluído" cor={C.brand} />
      </div>

      {resumo.pendencias.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 6 }}>
            Pendências identificadas
          </div>
          {resumo.pendencias.map((p) => (
            <div
              key={p.item}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 6,
                background: COR_BADGE[p.cor].bg,
                color: COR_BADGE[p.cor].txt,
                marginBottom: 4,
              }}
            >
              <span>{p.item}</span>
              <strong>{p.status}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: C.ok, marginBottom: 12 }}>
          ✅ Nenhuma pendência registrada até o momento.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Btn primary sm onClick={onSalvar} disabled={salvando}>
          {salvando ? "⏳ Salvando..." : travado ? "🔒 Vistoria salva" : "💾 Salvar vistoria"}
        </Btn>
        <Btn sm onClick={gerarPDF}>📄 Gerar PDF</Btn>
        <Btn sm onClick={copiar}>{copiado ? "✅ Copiado!" : "📋 Copiar relatório"}</Btn>
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted, alignSelf: "center" }}>
          Atualizado em {dataCurta(new Date().toISOString())}
        </span>
      </div>
    </Card>
  );
}
