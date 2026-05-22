// ── Linha label/valor dentro de um card ───────────────────────────

import type { ReactNode } from "react";
import { C } from "../../theme";

interface Props {
  label: string;
  children: ReactNode;
}

export default function Row({ label, children }: Props) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 0",
        borderBottom: `0.5px solid ${C.border}`,
        fontSize: 12,
        gap: 8,
      }}
    >
      <span style={{ color: C.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: C.text, fontWeight: 500 }}>
        {children}
      </span>
    </div>
  );
}

// Divisória reutilizável.
export const Sep = () => (
  <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
);
