// ── Card Cartão CNPJ / Receita Federal ────────────────────────────
// Mostra os dados completos da empresa e alerta se a situação
// cadastral não estiver ATIVA. O status (Regular/Irregular) é definido
// automaticamente pelo dashboard quando o CNPJ é carregado.

import type { Empresa } from "../../types";
import { LINKS, fmt, fmtCNPJ, dataCurta } from "../../config/vistoriaConfig";
import { C } from "../../theme";
import Card from "../ui/Card";
import Row, { Sep } from "../ui/Row";
import Btn from "../ui/Btn";

interface Props {
  empresa: Empresa;
  dataConsulta?: string;
}

export default function CartaoCNPJCard({ empresa, dataConsulta }: Props) {
  return (
    <Card
      title="Cartão CNPJ"
      icon="🏢"
      badgeLabel={empresa.ativa ? "Ativa" : "Irregular"}
    >
      {!empresa.ativa && (
        <div
          style={{
            background: C.errBg,
            color: C.err,
            borderRadius: 7,
            padding: "8px 10px",
            marginBottom: 10,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          ⚠️ Situação cadastral diferente de ATIVA: {empresa.situacaoCadastral}
        </div>
      )}
      <Row label="Situação cadastral">{fmt(empresa.situacaoCadastral)}</Row>
      <Row label="Natureza Jurídica">{fmt(empresa.naturezaJuridica)}</Row>
      <Row label="Porte">{fmt(empresa.porte)}</Row>
      <Row label="Capital Social">
        R${" "}
        {empresa.capitalSocial.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
        })}
      </Row>
      <Row label="Data de Abertura">{fmt(empresa.dataAbertura)}</Row>
      <Row label="E-mail">{fmt(empresa.email)}</Row>
      <Row label="Telefone">{fmt(empresa.telefone)}</Row>
      <Row label="Endereço">{fmt(empresa.endereco)}</Row>
      <Row label="CEP">{fmt(empresa.cep)}</Row>
      <Row label="Data da consulta">{dataCurta(dataConsulta)}</Row>
      {empresa.socios.length > 0 && (
        <>
          <Sep />
          <div style={{ fontSize: 11, color: C.muted }}>
            <strong style={{ color: C.text }}>QSA: </strong>
            {empresa.socios
              .map((s) => `${s.nome} (${s.qualificacao})`)
              .join(" · ")}
          </div>
        </>
      )}
      <Sep />
      <Btn sm href={LINKS.cartaoCNPJ}>
        🔗 Cartão CNPJ Oficial — {fmtCNPJ(empresa.cnpj)}
      </Btn>
    </Card>
  );
}
