import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const required = [
  'FINANCIAL_BUYER_PHONE',
  'FINANCIAL_BUYER_OTP',
  'FINANCIAL_BUYER_EXPECTED_CREDIT_MIN_MINOR',
  'FINANCIAL_SELLER_PHONE',
  'FINANCIAL_SELLER_OTP',
  'FINANCIAL_SELLER_EXPECTED_COD_MIN_MINOR',
  'FINANCIAL_ADMIN_PHONE',
  'FINANCIAL_ADMIN_OTP',
  'FINANCIAL_COD_ORDER_REFERENCE',
  'FINANCIAL_RECONCILED_REFERENCE',
  'FINANCIAL_EXCEPTION_REFERENCE',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Financial release gate BLOCKED: missing ${missing.join(', ')}`);
  process.exit(2);
}

const evidence = spawnSync(
  process.execPath,
  ['scripts/verify-financial-observability.mjs'],
  { stdio: 'inherit', env: process.env },
);
if (evidence.status !== 0) process.exit(evidence.status ?? 1);

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = spawnSync(
  npx,
  ['playwright', 'test', '--config', 'e2e/financial.playwright.config.ts'],
  { stdio: 'inherit', env: { ...process.env, CI: '1' } },
);

const reportPath = 'e2e/test-results/financial-results.json';
let report;
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch (error) {
  console.error(`Financial release gate FAIL: unreadable report ${reportPath}`, error);
  process.exit(1);
}

const tests = [];
const visit = (suite) => {
  for (const spec of suite.specs ?? []) tests.push(...(spec.tests ?? []));
  for (const child of suite.suites ?? []) visit(child);
};
for (const suite of report.suites ?? []) visit(suite);

const skipped = tests.filter((test) =>
  (test.results ?? []).some((result) => result.status === 'skipped') ||
  test.expectedStatus === 'skipped',
);
if (tests.length !== 5) {
  console.error(`Financial release gate FAIL: expected 5 tests, discovered ${tests.length}`);
  process.exit(1);
}
if (skipped.length) {
  console.error(`Financial release gate FAIL: ${skipped.length} financial test(s) skipped`);
  process.exit(1);
}
if (run.status !== 0) process.exit(run.status ?? 1);

console.log('Financial release gate PASS: observability and 5 authenticated journeys passed.');
