// ── Card de conferência genérico (config-driven) ──────────────────
// Renderiza qualquer card definido em CARDS_MANUAIS: 1+ status,
// campos extras (observação, nº processo, FISTEL...) e link manual.
// Usado por Inscrição Estadual, Nada Consta, Mosaico, SEI, FENINFRA
// e CREA/CFT — sem duplicar código.

import type { CardComumProps } from "../../types";
import type { CardManualConfig, CampoExtraKey } from "../../config/vistoriaConfig";
import { dataCurta, mesObrigatorio } from "../../config/vistoriaConfig";
import { C } from "../../theme";
import Card from "../ui/Card";
import Row, { Sep } from "../ui/Row";
import Btn from "../ui/Btn";
import StatusBadge from "../ui/StatusBadge";
import ManualStatusSelect from "../ui/ManualStatusSelect";
import Input from "../ui/Input";

interface Props extends CardComumProps {
  config: CardManualConfig;
}

export default function VistoriaCard({
  config,
  itens,
  setItem,
  travado,
  addLog,
}: Props) {
  const primaryId = config.subitens[0].id;
  const primario = itens[primaryId];
  const obrigatorioAgora = config.obrigatorioJanJun ? mesObrigatorio() : true;

  const alterarStatus = (subId: string, nome: string, valor: string) => {
    setItem(subId, {
      status: valor,
      manual: true,
      dataConsulta: new Date().toISOString(),
      fonte: "Conferência manual",
    });
    addLog(`📋 ${config.categoria} · ${nome}: ${valor}`);
  };

  const alterarCampo = (key: CampoExtraKey, valor: string) =>
    setItem(primaryId, { [key]: valor });

  return (
    <Card
      title={config.titulo}
      icon={config.icon}
      badgeLabel={primario?.status}
    >
      {config.descricao && (
        <div
          style={{
            background: config.obrigatorioJanJun && !obrigatorioAgora ? C.infoBg : C.grayBg,
            borderRadius: 7,
            padding: "8px 10px",
            marginBottom: 10,
            fontSize: 11,
            color: config.obrigatorioJanJun && !obrigatorioAgora ? C.infoTxt : C.muted,
          }}
        >
          {config.obrigatorioJanJun && !obrigatorioAgora
            ? "ℹ️ Fora do período obrigatório (jan/jun). Registre como Regular se nada mudou."
            : config.descricao}
        </div>
      )}

      {/* Status conferidos */}
      {config.subitens.map((sub) => {
        const est = itens[sub.id];
        return (
          <Row key={sub.id} label={sub.nome}>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <StatusBadge label={est?.status} pequeno />
              <ManualStatusSelect
                value={est?.status ?? sub.statusPadrao}
                options={sub.statusOptions}
                disabled={travado}
                onChange={(v) => alterarStatus(sub.id, sub.nome, v)}
              />
            </span>
          </Row>
        );
      })}

      {/* Campos extras */}
      {config.campos?.map((campo) =>
        campo.key === "observacao" ? (
          <Row key={campo.key} label={campo.label}>
            <Input
              value={primario?.observacao ?? ""}
              placeholder={campo.placeholder}
              disabled={travado}
              width={200}
              onChange={(v) => alterarCampo("observacao", v)}
            />
          </Row>
        ) : (
          <Row key={campo.key} label={campo.label}>
            <Input
              value={(primario?.[campo.key] as string) ?? ""}
              placeholder={campo.placeholder}
              disabled={travado}
              onChange={(v) => alterarCampo(campo.key, v)}
            />
          </Row>
        )
      )}

      <Row label="Data da conferência">
        {dataCurta(primario?.dataConsulta)}
      </Row>

      <Sep />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {config.link && (
          <Btn sm href={config.link}>
            {config.linkLabel ?? "🔗 Abrir site"}
          </Btn>
        )}
      </div>
    </Card>
  );
}
