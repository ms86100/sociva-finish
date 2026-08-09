import { test, expect } from '@playwright/test';
import {
  authenticateFinancialRole,
  requiredFinancialFixture,
} from './financial-auth';

test.describe('Financial release · buyer capability-off UX @financial @critical', () => {
  test('disabled wallet spend stays visible, unapplied, and clearly unavailable', async ({ page }) => {
    const minimumCreditMinor = Number(
      requiredFinancialFixture('FINANCIAL_BUYER_EXPECTED_CREDIT_MIN_MINOR'),
    );
    expect(minimumCreditMinor, 'buyer fixture must have positive existing credit').toBeGreaterThan(0);

    await authenticateFinancialRole(page, 'BUYER');
    const capabilitiesResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/rpc/get_financial_capabilities') &&
        response.request().method() === 'POST',
    );

    // The fixture must already contain a cart item. This test never adds an item
    // and never places an order or reserves credit.
    await page.goto('/#/cart');
    const capabilities = await (await capabilitiesResponse).json();
    expect(capabilities.wallet_spend_enabled).toBe(false);

    const creditPanel = page.getByText('Use Sociva Credit').locator('..').locator('..');
    await expect(creditPanel).toBeVisible();
    await expect(creditPanel).toContainText(/available/i);

    const displayed = await creditPanel.textContent();
    const displayedRupees = Number(
      displayed?.match(/₹\s*([\d,]+(?:\.\d+)?)/)?.[1]?.replaceAll(',', '') ?? 0,
    );
    expect(Math.round(displayedRupees * 100)).toBeGreaterThanOrEqual(minimumCreditMinor);

    await creditPanel.getByRole('switch').click();
    await expect(page.getByText('Sociva Credit spending is temporarily unavailable.')).toBeVisible();
    await expect(page.getByText(/Applying .* Sociva Credit/)).toHaveCount(0);
    await expect(creditPanel.getByRole('switch')).not.toBeChecked();
  });
});
