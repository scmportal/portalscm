// ── Seletor de status manual ──────────────────────────────────────

import { C } from "../../theme";

interface Props {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}

export default function ManualStatusSelect({
  value,
  options,
  onChange,
  disabled,
}: Props) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: 11,
        padding: "3px 8px",
        borderRadius: 6,
        border: `0.5px solid ${C.border}`,
        background: C.surface,
        color: C.text,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
