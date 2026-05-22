// ── Paleta e tokens visuais do SCM Vistorias ──────────────────────
// Centraliza cores para manter o layout consistente em todos os cards.

export const C = {
  brand: "#0057FF",
  brandDim: "#003DB3",
  ok: "#1A9F5E",
  okBg: "#E6F7EF",
  warn: "#B35F00",
  warnBg: "#FFF3E0",
  err: "#C0392B",
  errBg: "#FDECEA",
  infoBg: "#EAF1FF",
  infoTxt: "#003DB3",
  gray: "#6B7280",
  grayBg: "#F3F4F6",
  border: "rgba(0,0,0,0.1)",
  text: "#111827",
  muted: "#6B7280",
  white: "#fff",
  surface: "#fff",
  surface2: "#F9FAFB",
} as const;

export type StatusCor = "verde" | "amarelo" | "vermelho" | "cinza";

// Mapeia cada categoria de cor para o par (fundo / texto) usado nos badges.
export const COR_BADGE: Record<StatusCor, { bg: string; txt: string }> = {
  verde: { bg: C.okBg, txt: C.ok },
  amarelo: { bg: C.warnBg, txt: C.warn },
  vermelho: { bg: C.errBg, txt: C.err },
  cinza: { bg: C.grayBg, txt: C.gray },
};

export const fonteSans = "'IBM Plex Sans','Segoe UI',sans-serif";
export const fonteMono = "'IBM Plex Mono',monospace";
