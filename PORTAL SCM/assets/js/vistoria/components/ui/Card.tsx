// ── Wrapper de card com cabeçalho + badge/loading ─────────────────

import type { ReactNode } from "react";
import { C, fonteSans } from "../../theme";
import StatusBadge from "./StatusBadge";

interface Props {
  title: string;
  icon?: string;
  badgeLabel?: string;
  loading?: boolean;
  children: ReactNode;
  full?: boolean; // ocupa a linha inteira do grid
}

export default function Card({
  title,
  icon,
  badgeLabel,
  loading,
  children,
  full,
}: Props) {
  return (
    <div
      style={{
        gridColumn: full ? "1 / -1" : undefined,
        background: C.surface,
        border: `0.5px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden",
        fontFamily: fonteSans,
      }}
    >
      <div
        style={{
          padding: "9px 14px",
          background: C.surface2,
          borderBottom: `0.5px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.6px",
            color: C.muted,
          }}
        >
          {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
          {title}
        </div>
        {loading ? (
          <span style={{ fontSize: 10, color: C.brand }}>⏳ Consultando...</span>
        ) : (
          badgeLabel && <StatusBadge label={badgeLabel} />
        )}
      </div>
      <div style={{ padding: "12px 14px" }}>{children}</div>
    </div>
  );
}
