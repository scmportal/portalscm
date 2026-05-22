// ── ViewVistoria — adaptador da VISTORIA para o Portal SCM ────────
// Embute o dashboard de vistorias (antes app standalone) como uma aba
// dentro do portal. Reproduz o cabeçalho do App original: abas
// "Vistoria individual" / "Consulta em lote" e o botão de conexão com
// o SharePoint. O MSAL é preparado no mount (processa o retorno do
// login por redirect, quando configurado).

import { useEffect, useState } from "react";
import VistoriaDashboard from "./components/vistorias/VistoriaDashboard";
import LoteConsulta from "./components/lote/LoteConsulta";
import { C, fonteSans } from "./theme";
import {
  msalConfigurado,
  estaConectado,
  conectarSharePoint,
  prepararMsal,
} from "./services/msalAuth";

type Modo = "vistoria" | "lote";

export default function ViewVistoria() {
  const [modo, setModo] = useState<Modo>("vistoria");
  const conectado = estaConectado();

  // Processa o retorno do login por redirect (Microsoft Graph), se houver.
  useEffect(() => {
    prepararMsal();
  }, []);

  const Aba = ({ id, label }: { id: Modo; label: string }) => {
    const ativo = modo === id;
    return (
      <button
        onClick={() => setModo(id)}
        style={{
          border: "none",
          background: "transparent",
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: fonteSans,
          cursor: "pointer",
          color: ativo ? C.brand : C.muted,
          borderBottom: `2px solid ${ativo ? C.brand : "transparent"}`,
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 2px 16px rgba(0,0,0,0.06)",
        overflow: "hidden",
        maxWidth: 980,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          borderBottom: `0.5px solid ${C.border}`,
          background: C.surface,
          paddingRight: 12,
        }}
      >
        <Aba id="vistoria" label="🔎 Vistoria individual" />
        <Aba id="lote" label="📋 Consulta em lote" />

        {/* Status / conexão com o SharePoint */}
        {msalConfigurado() && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontFamily: fonteSans,
            }}
          >
            {conectado ? (
              <span style={{ fontSize: 11, color: C.ok, fontWeight: 600 }}>
                ● SharePoint conectado
              </span>
            ) : (
              <button
                onClick={() => conectarSharePoint()}
                style={{
                  border: `0.5px solid ${C.brand}`,
                  background: C.brand,
                  color: C.white,
                  borderRadius: 7,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                🔌 Conectar ao SharePoint
              </button>
            )}
          </div>
        )}
      </div>
      {modo === "vistoria" ? <VistoriaDashboard /> : <LoteConsulta />}
    </div>
  );
}
