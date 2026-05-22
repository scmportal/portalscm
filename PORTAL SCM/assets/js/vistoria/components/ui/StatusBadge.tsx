// ── Badge de status padronizado ───────────────────────────────────
// A cor é decidida SEMPRE pelo motor de regras (classificarStatus).

import { COR_BADGE } from "../../theme";
import { classificarStatus } from "../../services/statusRules";

interface Props {
  label?: string;
  pequeno?: boolean;
}

export default function StatusBadge({ label, pequeno }: Props) {
  if (!label) return null;
  const col = COR_BADGE[classificarStatus(label)];
  return (
    <span
      style={{
        background: col.bg,
        color: col.txt,
        padding: pequeno ? "1px 8px" : "2px 10px",
        borderRadius: 99,
        fontSize: pequeno ? 10 : 11,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: col.txt,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
