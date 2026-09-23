import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

/**
 * Headless E2E for bookable-service coupons.
 * Prefer local Vite (`npm run dev`) or a staging preview - not production-destructive.
 */
export default defineConfig({
  testDir: './tests/booking-coupons',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join('..', 'qa-evidence', 'booking-coupons', 'playwright-report'), open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    viewport: { width: 390, height: 844 },
  },
  outputDir: path.join('..', 'qa-evidence', 'booking-coupons', 'test-results'),
  projects: [
    {
      name: 'chromium-headless',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
});
