// ── Card Coletas ANATEL ───────────────────────────────────────────
// Quando os dados vêm do SharePoint REAL, mostra a seção completa
// "Envio das Coletas de dados" (todos os campos da lista). Sem isso,
// cai na tabela-resumo derivada (SCM/SeAC/STFC/Infra...).

import type { CSSProperties } from "react";
import type { ColetaSharePoint } from "../../types";
import { LINKS, fmt } from "../../config/vistoriaConfig";
import { C } from "../../theme";
import Card from "../ui/Card";
import { Sep } from "../ui/Row";
import Btn from "../ui/Btn";
import StatusBadge from "../ui/StatusBadge";

interface Props {
  coletas: ColetaSharePoint[];
  loading: boolean;
  pendencias: string[];
  detalhado?: { label: string; valor: string }[];
}

// Campos que devem aparecer como badge de status (e não texto puro).
const ehStatus = (label: string) =>
  /^status|zerado|fluxo pa/i.test(label.trim());

export default function ColetasAnatelCard({
  coletas,
  loading,
  pendencias,
  detalhado,
}: Props) {
  const temDetalhe = (detalhado?.length ?? 0) > 0;
  const badge =
    !temDetalhe && coletas.length === 0
      ? "Não consultado"
      : pendencias.length > 0
      ? "Pendente"
      : "Finalizado";

  return (
    <Card
      title="Envio das Coletas de dados"
      icon="📊"
      badgeLabel={badge}
      loading={loading}
      full
    >
      {temDetalhe ? (
        // ── Visão completa (SharePoint real) ──────────────────────
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "8px 18px",
          }}
        >
          {detalhado!.map((campo) => (
            <div
              key={campo.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                padding: "5px 0",
                borderBottom: `0.5px solid ${C.border}`,
                fontSize: 12,
              }}
            >
              <span style={{ color: C.muted }}>{campo.label}</span>
              {campo.valor ? (
                ehStatus(campo.label) ? (
                  <StatusBadge label={campo.valor} pequeno />
                ) : (
                  <span style={{ fontWeight: 500, textAlign: "right" }}>
                    {campo.valor}
                  </span>
                )
              ) : (
                <span style={{ color: C.border }}>—</span>
              )}
            </div>
          ))}
        </div>
      ) : coletas.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted }}>
          Sincronize o SharePoint para carregar o status das coletas.
        </div>
      ) : (
        // ── Visão-resumo (fallback / modo simulado) ───────────────
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: C.muted, textAlign: "left" }}>
                <th style={th}>Coleta</th>
                <th style={th}>Status</th>
                <th style={th}>Data status</th>
                <th style={th}>Comprovante</th>
              </tr>
            </thead>
            <tbody>
              {coletas.map((c) => (
                <tr key={c.nome} style={{ borderTop: `0.5px solid ${C.border}` }}>
                  <td style={td}>{c.nome}</td>
                  <td style={td}>
                    <StatusBadge label={c.status} pequeno />
                  </td>
                  <td style={td}>{fmt(c.dataStatus)}</td>
                  <td style={td}>
                    {c.dataComprovante ? (
                      <StatusBadge label="Comprovante anexado" pequeno />
                    ) : (
                      <span style={{ color: C.muted }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Sep />
      <Btn sm href={LINKS.coleta}>
        🔗 Coleta ANATEL
      </Btn>
    </Card>
  );
}

const th: CSSProperties = { padding: "4px 8px", fontWeight: 600 };
const td: CSSProperties = { padding: "6px 8px", color: C.text };
