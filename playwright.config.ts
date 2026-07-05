import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// W środowiskach zarządzanych Chromium bywa preinstalowany pod tą ścieżką —
// używamy go zamiast pobierać przeglądarkę na nowo.
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Tablet w orientacji poziomej
    viewport: { width: 1280, height: 800 },
    launchOptions: existsSync(PREINSTALLED_CHROMIUM)
      ? { executablePath: PREINSTALLED_CHROMIUM }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    env: {
      // Puste = same-origin; testy przechwytują /api/** przez page.route bez CORS
      VITE_API_BASE_URL: '',
    },
  },
});
