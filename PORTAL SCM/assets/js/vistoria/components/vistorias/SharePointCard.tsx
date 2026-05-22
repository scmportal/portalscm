// ── Card SharePoint / Cartão do Cliente ───────────────────────────
// Exibe os dados já preenchidos no cartão do cliente (Microsoft Lists)
// e permite ressincronizar. Os dados vêm do sharepointService (mock
// hoje, integração real depois).

import type { SharePointCliente } from "../../types";
import { LINKS, fmt, dataCurta } from "../../config/vistoriaConfig";
import { C } from "../../theme";
import Card from "../ui/Card";
import Row, { Sep } from "../ui/Row";
import Btn from "../ui/Btn";
import StatusBadge from "../ui/StatusBadge";

interface Props {
  cliente: SharePointCliente | null;
  loading: boolean;
  pendencias: string[];
  aviso?: string;
  onSincronizar: () => void;
}

export default function SharePointCard({
  cliente,
  loading,
  pendencias,
  aviso,
  onSincronizar,
}: Props) {
  const badge = !cliente
    ? "Não consultado"
    : pendencias.length > 0
    ? "Pendente"
    : "Sem pendências";

  return (
    <Card title="Cartão do Cliente / SharePoint" icon="🗃️" badgeLabel={badge} loading={loading}>
      {aviso && (
        <div
          style={{
            background: C.errBg,
            color: C.err,
            borderRadius: 7,
            padding: "8px 10px",
            marginBottom: 10,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ⚠️ {aviso}
        </div>
      )}
      {!cliente ? (
        <div style={{ fontSize: 12, color: C.muted }}>
          Clique em “Sincronizar SharePoint” para carregar o cartão do cliente.
        </div>
      ) : (
        <>
          {cliente.simulado && (
            <div
              style={{
                background: C.warnBg,
                color: C.warn,
                borderRadius: 7,
                padding: "8px 10px",
                marginBottom: 10,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              ⚠️ Dados SIMULADOS. Configure a integração real (ver
              docs/INTEGRACAO_SHAREPOINT.md) para puxar a lista verdadeira.
            </div>
          )}
          <Row label="Status SCM">
            <StatusBadge label={cliente.statusSCM} pequeno />
          </Row>
          <Row label="Status SeAC">
            <StatusBadge label={cliente.statusSeAC} pequeno />
          </Row>
          <Row label="Status STFC">
            <StatusBadge label={cliente.statusSTFC} pequeno />
          </Row>
          <Row label="Status FENINFRA">
            <StatusBadge label={cliente.statusFeninfra} pequeno />
          </Row>
          <Row label="FISTEL">{fmt(cliente.fistel)}</Row>
          <Row label="Login FENINFRA">{fmt(cliente.loginFeninfra)}</Row>
          <Row label="Consultor">{fmt(cliente.consultor)}</Row>
          <Row label="Última atualização">
            {dataCurta(cliente.ultimaSincronizacao)}
          </Row>

          {pendencias.length > 0 && (
            <>
              <Sep />
              <div style={{ fontSize: 11, color: C.err }}>
                <strong>Pendências detectadas:</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                  {pendencias.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </>
      )}

      <Sep />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Btn sm primary onClick={onSincronizar} disabled={loading}>
          {loading ? "⏳ Sincronizando..." : "🔄 Sincronizar SharePoint"}
        </Btn>
        <Btn sm href={LINKS.sharepoint}>
          🔗 Abrir lista
        </Btn>
      </div>
    </Card>
  );
}
