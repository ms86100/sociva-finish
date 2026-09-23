import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const EVIDENCE = path.join('..', 'test-results', 'seller-onboarding-ux');

/**
 * Seller onboarding draft/resume UX — always capture screenshot/video/trace.
 */
export default defineConfig({
  testDir: './tests/seller-onboarding-ux',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(EVIDENCE, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(EVIDENCE, 'report', 'results.json') }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    actionTimeout: 25_000,
    navigationTimeout: 45_000,
    viewport: { width: 390, height: 844 },
  },
  outputDir: path.join(EVIDENCE, 'artifacts'),
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
