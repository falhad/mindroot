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
  webServer: { command: 'pnpm dev', url: 'http://localhost:1420', reuseExistingServer: !process.env.CI, timeout: 60_000 },
})
