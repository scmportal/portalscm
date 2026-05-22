// ── Card de observações da vistoria ───────────────────────────────

import { C } from "../../theme";
import Card from "../ui/Card";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export default function ObservacoesCard({ value, onChange, disabled }: Props) {
  return (
    <Card title="Observações da vistoria" icon="📝" full>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Registre irregularidades, pendências identificadas, recomendações ao cliente..."
        style={{
          width: "100%",
          minHeight: 90,
          padding: "8px 10px",
          border: `0.5px solid ${C.border}`,
          borderRadius: 7,
          fontSize: 12,
          fontFamily: "inherit",
          resize: "vertical",
          background: disabled ? C.surface2 : C.white,
          color: C.text,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </Card>
  );
}
