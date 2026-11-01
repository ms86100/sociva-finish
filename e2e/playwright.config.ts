import { defineConfig, devices } from '@playwright/test';

/**
 * E2E always targets this workspace by default (local Vite preview).
 * Never silently hit a remote Lovable deploy - that hides local regressions
 * and can mutate / assert against the wrong build.
 *
 * Override only when intentional:
 *   BASE_URL=https://staging.example.com E2E_ALLOW_REMOTE=1 npm run test:e2e
 */
const LOCAL_PREVIEW = 'http://127.0.0.1:4173';
const BASE_URL = (process.env.BASE_URL || LOCAL_PREVIEW).replace(/\/+$/, '');
const isLocalBaseUrl = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE_URL);
const isLovableRemote = /lovable\.app/i.test(BASE_URL);

if (isLovableRemote && process.env.E2E_ALLOW_REMOTE !== '1') {
  throw new Error(
    `Refusing E2E against ${BASE_URL}. Default is ${LOCAL_PREVIEW}. ` +
      'Set BASE_URL to a local preview, or set E2E_ALLOW_REMOTE=1 for an intentional remote run.',
  );
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  webServer: isLocalBaseUrl
    ? {
        // Preview only - callers must build first (CI and npm run test:e2e* do).
        command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,

  projects: [
    // Setup project - authenticates buyer & seller, caches storageState
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },

    // Desktop Chrome (authenticated suite). Guest/native pretend specs live in today-prompts.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: [/today\//, /buyer\/discovery-smoke\.spec\.ts/],
    },

    // Mobile Chrome (Pixel 5)
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      dependencies: ['setup'],
      grep: [/@mobile/, /@smoke/, /@critical/],
      testIgnore: [/today\//, /buyer\/discovery-smoke\.spec\.ts/],
    },

    // Mobile Safari (iPhone 13)
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      dependencies: ['setup'],
      grep: [/@mobile/, /@smoke/, /@critical/],
      testIgnore: [/today\//, /buyer\/discovery-smoke\.spec\.ts/],
    },

    // Guest + Capacitor-pretend home prompts - no auth storageState.
    // Block service workers so PWA cache cannot hide mocked update notices.
    {
      name: 'today-prompts',
      testMatch: /today\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        serviceWorkers: 'block',
      },
    },

    // Public discovery smoke projects intentionally avoid authenticated setup.
    {
      name: 'discovery-desktop',
      testMatch: /buyer\/discovery-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      name: 'discovery-mobile',
      testMatch: /buyer\/discovery-smoke\.spec\.ts/,
      use: { ...devices['Pixel 5'], serviceWorkers: 'block' },
    },
  ],

  outputDir: 'test-results',
});
