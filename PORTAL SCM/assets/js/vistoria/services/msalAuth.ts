// ── Autenticação Microsoft (MSAL) para o Microsoft Graph ──────────
// Usa LOGIN POR REDIRECIONAMENTO (loginRedirect), que é o método mais
// confiável: a página vai ao login da Microsoft e volta — sem popup e
// sem iframe (que o Chrome bloqueia, causando o erro "timed_out").
//
// Fluxo:
//   1) prepararMsal() roda no carregamento do app e processa o retorno
//      do login (handleRedirectPromise), guardando a conta.
//   2) conectarSharePoint() dispara o login (redireciona).
//   3) obterTokenGraph() pega o token silenciosamente da conta logada.
//
// Inert enquanto VITE_MSAL_* não estiver no .env.

import { PublicClientApplication, type AccountInfo } from "@azure/msal-browser";

const clientId = import.meta.env.VITE_MSAL_CLIENT_ID as string | undefined;
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID as string | undefined;

export const msalConfigurado = (): boolean => Boolean(clientId && tenantId);

const SCOPES = ["https://graph.microsoft.com/Sites.Read.All"];

// Erro padronizado quando ainda não há login válido.
export const PRECISA_CONECTAR = "PRECISA_CONECTAR";

let pca: PublicClientApplication | null = null;
let inicializado = false;

async function instancia(): Promise<PublicClientApplication> {
  if (!msalConfigurado()) {
    throw new Error("MSAL não configurado (defina VITE_MSAL_CLIENT_ID e VITE_MSAL_TENANT_ID).");
  }
  if (!pca) {
    pca = new PublicClientApplication({
      auth: {
        clientId: clientId!,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "localStorage" },
    });
  }
  if (!inicializado) {
    await pca.initialize();
    inicializado = true;
  }
  return pca;
}

export function contaAtual(): AccountInfo | null {
  return pca?.getAllAccounts()[0] ?? null;
}

export function estaConectado(): boolean {
  return !!pca && pca.getAllAccounts().length > 0;
}

// Roda no carregamento do app: processa o retorno do redirect de login.
export async function prepararMsal(): Promise<void> {
  if (!msalConfigurado()) return;
  try {
    const app = await instancia();
    const res = await app.handleRedirectPromise();
    if (res?.account) app.setActiveAccount(res.account);
  } catch (e) {
    console.warn("[MSAL] prepararMsal:", e);
  }
}

// Dispara o login da Microsoft (redireciona a página inteira).
export async function conectarSharePoint(): Promise<void> {
  const app = await instancia();
  await app.loginRedirect({ scopes: SCOPES });
}

// Obtém um access token do Graph a partir da conta já logada.
// Se não houver login válido, lança PRECISA_CONECTAR.
export async function obterTokenGraph(): Promise<string> {
  const app = await instancia();
  const account = app.getActiveAccount() ?? app.getAllAccounts()[0];
  if (!account) throw new Error(PRECISA_CONECTAR);
  try {
    const r = await app.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch {
    throw new Error(PRECISA_CONECTAR);
  }
}

export async function sairMsal(): Promise<void> {
  if (pca) await pca.logoutRedirect();
}
