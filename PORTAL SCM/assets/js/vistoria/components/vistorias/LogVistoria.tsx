// ── Log da vistoria ───────────────────────────────────────────────

import type { LogEntry } from "../../types";
import { C, fonteMono } from "../../theme";
import Card from "../ui/Card";

interface Props {
  logs: LogEntry[];
}

export default function LogVistoria({ logs }: Props) {
  if (logs.length === 0) return null;
  return (
    <Card title="Log da vistoria" icon="🗒️" full>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {logs.map((l, i) => (
          <div
            key={i}
            style={{ display: "flex", gap: 10, fontSize: 11, alignItems: "flex-start" }}
          >
            <span style={{ color: C.muted, fontFamily: fonteMono, flexShrink: 0, width: 56 }}>
              {l.time}
            </span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: l.cor,
                marginTop: 4,
                flexShrink: 0,
              }}
            />
            <span style={{ color: C.text }}>{l.msg}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
