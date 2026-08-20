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
          // Every board spec signs a fresh user up; the production budget is 5 signups/hour/IP,
          // which the suite legitimately exceeds. Honoured only outside NEXUS_ENV=production.
          // The journeys cover the *server* shape (accounts, API, database). The local shape has
          // its own acceptance suite in apps/web (src/app/localMode.test.tsx), which asserts the
          // app boots with fetch/XHR/WebSocket sabotaged — something a stack-backed browser test
          // cannot assert.
          env: {
            AUTH_SIGNUP_LIMIT: '500',
            // Whole suite shares one IP, so the unauthenticated requests share one budget bucket.
            API_RATE_LIMIT: '100000',
            VITE_APP_MODE: 'server',
            APP_MODE: 'server',
          },
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
          // Without piping, api/web startup errors are swallowed and a failing globalSetup gives
          // no clue about why the stack never came up.
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      }),
});
