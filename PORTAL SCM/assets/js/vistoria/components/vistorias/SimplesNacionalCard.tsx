// ── Card Simples Nacional ─────────────────────────────────────────
// Optante / Não optante é determinado automaticamente a partir dos
// dados da Receita (BrasilAPI). O consultor ainda pode sobrescrever
// manualmente. Obrigatória em janeiro/junho.

import type { CardComumProps, Empresa } from "../../types";
import { LINKS, SIMPLES_OPTIONS, dataCurta, mesObrigatorio } from "../../config/vistoriaConfig";
import { avaliarSimples } from "../../services/consultaExternaService";
import { C } from "../../theme";
import Card from "../ui/Card";
import Row, { Sep } from "../ui/Row";
import Btn from "../ui/Btn";
import StatusBadge from "../ui/StatusBadge";
import ManualStatusSelect from "../ui/ManualStatusSelect";

interface Props extends CardComumProps {
  empresa: Empresa;
}

export default function SimplesNacionalCard({
  empresa,
  itens,
  setItem,
  travado,
  addLog,
}: Props) {
  const est = itens["simples"];
  const obrigatorio = mesObrigatorio();

  const reavaliar = () => {
    const r = avaliarSimples(empresa);
    setItem("simples", {
      status: r.status,
      resultado: r.detalhe,
      fonte: r.fonte,
      manual: false,
      dataConsulta: new Date().toISOString(),
    });
    addLog(`⚡ Simples Nacional: ${r.status} — ${r.detalhe}`, r.automatica ? C.ok : C.warn);
  };

  const registrarManual = (v: string) => {
    setItem("simples", {
      status: v,
      manual: true,
      fonte: "Conferência manual",
      dataConsulta: new Date().toISOString(),
    });
    addLog(`📋 Simples Nacional registrado manualmente: ${v}`);
  };

  return (
    <Card title="Simples Nacional" icon="📋" badgeLabel={est?.status}>
      <div
        style={{
          background: obrigatorio ? C.warnBg : C.infoBg,
          borderRadius: 7,
          padding: "8px 10px",
          marginBottom: 10,
          fontSize: 11,
          color: obrigatorio ? C.warn : C.infoTxt,
        }}
      >
        {obrigatorio
          ? "⚠️ Mês de consulta obrigatória — confira a opção pelo Simples."
          : "ℹ️ Fora de jan/jun. Resultado preenchido automaticamente pela Receita."}
      </div>

      <Row label="Situação">
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <StatusBadge label={est?.status} pequeno />
          <ManualStatusSelect
            value={est?.status ?? "Não consultado"}
            options={SIMPLES_OPTIONS}
            disabled={travado}
            onChange={registrarManual}
          />
        </span>
      </Row>
      <Row label="Detalhe">{est?.resultado || "—"}</Row>
      <Row label="Fonte">{est?.fonte || "—"}</Row>
      <Row label="Data da consulta">{dataCurta(est?.dataConsulta)}</Row>

      <Sep />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Btn sm primary onClick={reavaliar} disabled={travado}>
          ⚡ Reavaliar pela Receita
        </Btn>
        <Btn sm href={LINKS.simples}>
          🔗 Receita Federal (manual)
        </Btn>
      </div>
    </Card>
  );
}
