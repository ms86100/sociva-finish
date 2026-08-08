import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'https://sociva.lovable.app';
const isLocalBaseUrl = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE_URL);

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
        command: 'npm run preview -- --host 127.0.0.1 --port 4173',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,

  projects: [
    // Setup project — authenticates buyer & seller, caches storageState
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },

    // Desktop Chrome
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    // Mobile Chrome (Pixel 5)
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      dependencies: ['setup'],
      grep: [/@mobile/, /@smoke/, /@critical/],
    },

    // Mobile Safari (iPhone 13)
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
      dependencies: ['setup'],
      grep: [/@mobile/, /@smoke/, /@critical/],
    },

    // Public discovery smoke projects intentionally avoid authenticated setup.
    // They can run against a local production preview or a configured deployment.
    {
      name: 'discovery-desktop',
      testMatch: /buyer\/discovery-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'discovery-mobile',
      testMatch: /buyer\/discovery-smoke\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
  ],

  outputDir: 'test-results',
});
