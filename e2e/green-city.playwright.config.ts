import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Green City / A Cleaner City headless Chrome suite.
 * Local Vite preview only by default (same safety as main e2e config).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_PREVIEW = 'http://127.0.0.1:4173';
const BASE_URL = (process.env.BASE_URL || LOCAL_PREVIEW).replace(/\/+$/, '');
const isLocalBaseUrl = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE_URL);

if (!isLocalBaseUrl && process.env.E2E_ALLOW_REMOTE !== '1') {
  throw new Error(
    `Refusing Green City E2E against ${BASE_URL}. Use local preview or set E2E_ALLOW_REMOTE=1.`,
  );
}

export default defineConfig({
  testDir: './tests/green-city',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'green-city-playwright-report', open: 'never' }],
    ['json', { outputFile: path.join(ROOT, 'qa-evidence/green-city-e2e-cert/playwright-results.json') }],
  ],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    serviceWorkers: 'block',
    ...devices['Desktop Chrome'],
  },
  webServer: isLocalBaseUrl
    ? {
        command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
        cwd: ROOT,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : undefined,
  outputDir: path.join(ROOT, 'qa-evidence/green-city-e2e-cert/test-results'),
});
