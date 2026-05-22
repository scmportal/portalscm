import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // basicSsl gera um certificado autoassinado p/ servir em https://.
  // Sem isso, acessar pela rede (http://<IP>:5173) deixa window.crypto.subtle
  // indisponível e o MSAL falha com "crypto_nonexistent".
  plugins: [react(), basicSsl()],
  server: {
    https: true,       // contexto seguro — necessário para o Web Crypto / MSAL
    host: true,        // expõe na rede (0.0.0.0) — acessível por outros dispositivos da LAN
    port: 5173,
    strictPort: true,
    // Proxy de DEV para a BrasilAPI: o navegador chama /brasilapi/... no
    // próprio dev server e o Vite repassa server-to-server. Isso elimina
    // erros de CORS (respostas de erro da BrasilAPI vêm sem cabeçalho CORS)
    // e contorna extensões do navegador que bloqueiam o domínio.
    proxy: {
      "/brasilapi": {
        target: "https://brasilapi.com.br",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/brasilapi/, ""),
      },
    },
  },
  preview: {
    https: true,
    host: true,
    port: 4173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        adm: resolve(__dirname, 'adm/index.html'),
        cliente: resolve(__dirname, 'cliente/index.html'),
        consultor: resolve(__dirname, 'consultor-scm/index.html'),
      },
    },
  },
});
