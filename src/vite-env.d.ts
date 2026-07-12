/// <reference types="vite/client" />

/**
 * Identyfikator builda wstrzykiwany przez `define` w vite.config.ts.
 * W środowiskach bez Vite (vitest/node) jest niezdefiniowany — moduł
 * shell/update.ts obsługuje to przez `typeof`-guard.
 */
declare const __BUILD_ID__: string | undefined;

interface ImportMetaEnv {
  /** Bazowy URL backendu API; pusty string = same-origin (testy e2e). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
