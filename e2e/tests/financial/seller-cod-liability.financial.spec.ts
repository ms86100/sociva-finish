import { test, expect } from '@playwright/test';
import {
  authenticateFinancialRole,
  parseMinorUnits,
  requiredFinancialFixture,
} from './financial-auth';

test.describe('Financial release · seller COD and liabilities @financial @critical', () => {
  test('COD is excluded from payable while COD and liabilities remain visible', async ({ page }) => {
    const minimumCodMinor = Number(
      requiredFinancialFixture('FINANCIAL_SELLER_EXPECTED_COD_MIN_MINOR'),
    );
    expect(minimumCodMinor, 'seller fixture must contain existing COD history').toBeGreaterThan(0);

    await authenticateFinancialRole(page, 'SELLER');
    const summaryResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/rpc/get_seller_financial_summary') &&
        response.request().method() === 'POST',
    );
    await page.goto('/#/seller/payouts');

    const summary = await (await summaryResponse).json() as Record<string, unknown>;
    const codMinor =
      parseMinorUnits(summary.cod_expected) + parseMinorUnits(summary.cod_collected);
    expect(codMinor).toBeGreaterThanOrEqual(minimumCodMinor);

    const onlinePayableMinor = ['pending', 'available', 'reserved', 'on_hold']
      .map((key) => parseMinorUnits(summary[key]))
      .reduce((total, amount) => total + amount, 0);

    await expect(page.getByText('Ledger only — not a bank payout')).toBeVisible();
    const owedCard = page.getByText(/Owed \(pending \/ eligible\)/).locator('..');
    await expect(owedCard).toBeVisible();
    const owedText = await owedCard.textContent();
    const owedRupees = Number(
      owedText?.match(/₹\s*([\d,]+(?:\.\d+)?)/)?.[1]?.replaceAll(',', '') ?? 0,
    );
    expect(Math.round(owedRupees * 100)).toBe(onlinePayableMinor);

    // These disclosures are release requirements. Their absence is a hard
    // failure, not a reason to skip the journey.
    await expect(page.getByText(/Seller-collected COD/i)).toBeVisible();
    await expect(page.getByText(/Liabilit(?:y|ies)|Offsets? due/i)).toBeVisible();
  });
});
