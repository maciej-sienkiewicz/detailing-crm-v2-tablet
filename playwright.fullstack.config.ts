import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Pełny stos: prawdziwy backend (REST + WebSocket), prawdziwa aplikacja tabletu,
 * a kroki CRM przez te same endpointy, których używa CRM. Bez atrap - to jest
 * test kontraktu między trzema aplikacjami, nie samego tabletu.
 *
 * Wymaga działającego backendu (domyślnie http://localhost:8080) z Postgresem,
 * Redisem i usługą zgodną z S3 - przepis w e2e-fullstack/README.md.
 *
 *   E2E_BACKEND_URL=http://localhost:8080 npm run test:e2e:fullstack
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e-fullstack',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // Inny port niż e2e z atrapami: tamten serwer ma pusty adres API (same-origin).
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
    launchOptions: existsSync(PREINSTALLED_CHROMIUM)
      ? { executablePath: PREINSTALLED_CHROMIUM }
      : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    // Backend dopuszcza CORS i handshake WS z http://localhost:* - tablet łączy się
    // z nim wprost, tak jak na produkcji, razem z WebSocketem.
    env: { VITE_API_BASE_URL: BACKEND_URL },
  },
});
