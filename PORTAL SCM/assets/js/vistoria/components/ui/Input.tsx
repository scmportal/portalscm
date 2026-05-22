// ── Input de texto pequeno reutilizável ───────────────────────────

import { C, fonteMono } from "../../theme";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  width?: number | string;
}

export default function Input({
  value,
  onChange,
  placeholder,
  disabled,
  mono,
  width = 180,
}: Props) {
  return (
    <input
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: 11,
        padding: "3px 8px",
        border: `0.5px solid ${C.border}`,
        borderRadius: 6,
        background: C.white,
        color: C.text,
        width,
        fontFamily: mono ? fonteMono : "inherit",
        outline: "none",
        opacity: disabled ? 0.6 : 1,
      }}
    />
  );
}
