import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/buyer',
  testMatch: /closed-store-schedule\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'on-first-retry',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
