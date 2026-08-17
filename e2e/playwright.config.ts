import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  globalSetup: './global.setup.ts',
  timeout: 45_000, // per-spec ceiling (18_TESTING.md open risk 6)
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    colorScheme: 'dark', // the product is dark-theme only
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Locally Playwright starts the stack; set E2E_NO_SERVER=1 when something is already running
  // (CI starts the services itself).
  ...(process.env.E2E_NO_SERVER
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          cwd: '..',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
