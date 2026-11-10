import { defineConfig, devices } from '@playwright/test'

/** End-to-end tests run the web build (maps live in IndexedDB), the same UI the desktop app shows. */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:1420', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    { command: 'pnpm dev', url: 'http://localhost:1420', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    // the live-collaboration relay, for the two-browser tests
    {
      command: 'node server/relay/src/index.js',
      url: 'http://127.0.0.1:8787/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: { SECRET: 'e2e-relay-secret-0123456789abcdef', PORT: '8787', HOST: '127.0.0.1', DATA_DIR: '.relay-e2e-data' },
    },
  ],
})
