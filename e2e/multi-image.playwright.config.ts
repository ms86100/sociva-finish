import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

/**
 * Dedicated config for multi-image E2E - always captures screenshot/video/trace evidence.
 * Does not depend on global.setup email seller auth.
 */
export default defineConfig({
  testDir: './tests/multi-image',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join('..', 'qa-evidence', 'multi-image', 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join('..', 'qa-evidence', 'multi-image', 'report', 'results.json') }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    viewport: { width: 390, height: 844 }, // mobile-first default
  },
  outputDir: path.join('..', 'qa-evidence', 'multi-image', 'test-results'),
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 13'] },
      grep: /@mobile|@buyer-carousel|@single-image/,
    },
  ],
});
