import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Identyfikator builda dla mechanizmu samo-aktualizacji kiosku:
 *  - wkompilowany do bundla jako `__BUILD_ID__`,
 *  - wystawiony obok jako `/version.json`.
 * Tablet w STANDBY porównuje obie wartości i przeładowuje się, gdy serwer
 * ma nowszą powłokę. GIT_COMMIT pochodzi z ARG w Dockerfile; fallback z
 * timestampem gwarantuje unikalny identyfikator także dla buildów bez commita.
 */
const buildId = process.env.GIT_COMMIT?.trim() || `local-${Date.now()}`;

function versionJsonPlugin(): Plugin {
  const payload = JSON.stringify({ buildId });
  return {
    name: 'detailboost-version-json',
    // Build produkcyjny: version.json trafia do dist obok index.html.
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: payload });
    },
    // Dev server: ten sam kontrakt co produkcja (przydatne w e2e).
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(payload);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  define: {
    // sockjs-client odwołuje się do `global` (dziedzictwo Node) — mapujemy na globalThis
    global: 'globalThis',
    __BUILD_ID__: JSON.stringify(buildId),
  },
  optimizeDeps: {
    include: ['sockjs-client'],
  },
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws-registry': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Rename .mjs assets to .js so servers without explicit MIME config
        // for .mjs still serve them as application/javascript.
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.mjs')) {
            return 'assets/[name]-[hash].js';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
