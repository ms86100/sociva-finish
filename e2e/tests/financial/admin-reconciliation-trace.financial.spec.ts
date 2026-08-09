import { test, expect, type Page } from '@playwright/test';
import {
  authenticateFinancialRole,
  requiredFinancialFixture,
} from './financial-auth';

async function openTrace(page: Page, reference: string) {
  await page.goto('/#/admin/financial-trace');
  await expect(page.getByRole('heading', { name: 'Financial Trace' })).toBeVisible();
  await expect(page.getByText(/Read-only admin evidence/)).toBeVisible();
  await page.getByLabel('Financial reference').fill(reference);
  await page.getByRole('button', { name: /^Trace$/ }).click();
}

test.describe('Financial release · admin trace @financial @critical', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateFinancialRole(page, 'ADMIN');
  });

  test('COD order trace has COD evidence and no seller settlement', async ({ page }) => {
    await openTrace(page, requiredFinancialFixture('FINANCIAL_COD_ORDER_REFERENCE'));
    await expect(page.getByText(/^cod · [1-9]\d*$/i)).toBeVisible();
    await expect(page.getByText(/^settlements ·/i)).toHaveCount(0);
  });

  test('reconciled reference exposes exact reconciliation evidence', async ({ page }) => {
    await openTrace(page, requiredFinancialFixture('FINANCIAL_RECONCILED_REFERENCE'));
    await expect(page.getByText(/^reconciliation · [1-9]\d*$/i)).toBeVisible();
    await expect(page.locator('pre')).toContainText(/"difference_minor"\s*:\s*0/);
    await expect(page.locator('pre')).toContainText(/"status"\s*:\s*"matched"/);
  });

  test('exception reference exposes exception status and ownership trace', async ({ page }) => {
    await openTrace(page, requiredFinancialFixture('FINANCIAL_EXCEPTION_REFERENCE'));
    await expect(page.getByText(/^exceptions? · [1-9]\d*$/i)).toBeVisible();
    await expect(page.locator('pre')).toContainText(/"status"\s*:\s*"(open|investigating)"/);
    await expect(page.locator('pre')).toContainText(/"(owner_id|assigned_to)"\s*:/);
  });
});
