// ── Botão / link estilizado ───────────────────────────────────────

import type { ReactNode, CSSProperties } from "react";
import { C } from "../../theme";

interface Props {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  sm?: boolean;
  disabled?: boolean;
  href?: string;
}

export default function Btn({
  children,
  onClick,
  primary,
  sm,
  disabled,
  href,
}: Props) {
  const style: CSSProperties = {
    height: sm ? 26 : 32,
    padding: sm ? "0 10px" : "0 14px",
    border: `0.5px solid ${primary ? C.brand : C.border}`,
    borderRadius: 7,
    fontSize: sm ? 11 : 12,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    background: primary ? C.brand : C.surface,
    color: primary ? C.white : C.text,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    opacity: disabled ? 0.5 : 1,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" style={style}>
        {children}
      </a>
    );
  }
  return (
    <button style={style} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
