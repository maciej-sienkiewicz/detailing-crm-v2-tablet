/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Bazowy URL backendu API; pusty string = same-origin (testy e2e). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
