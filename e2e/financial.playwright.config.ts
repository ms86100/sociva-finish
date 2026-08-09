import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/financial',
  testMatch: /.*\.financial\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/financial-results.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.FINANCIAL_BASE_URL || 'https://www.sociva.in',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  outputDir: 'test-results/financial-artifacts',
});
