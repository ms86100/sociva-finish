import { expect, type Page } from '@playwright/test';

export type FinancialRole = 'BUYER' | 'SELLER' | 'ADMIN';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Financial release prerequisite missing: ${name}. ` +
      'Authenticated financial journeys must fail, never skip.',
    );
  }
  return value;
}

export function requiredFinancialFixture(name: string): string {
  return required(name);
}

export async function authenticateFinancialRole(page: Page, role: FinancialRole) {
  const phone = required(`FINANCIAL_${role}_PHONE`);
  const otp = required(`FINANCIAL_${role}_OTP`);

  await page.goto('/#/auth');
  await page.getByLabel('Phone Number').fill(phone);

  const age = page.locator('#age-confirm');
  if ((await age.getAttribute('data-state')) !== 'checked') await age.click();
  await page.getByRole('button', { name: /send otp|continue/i }).click();

  const otpInput = page.locator('input[autocomplete="one-time-code"]').first();
  await expect(otpInput).toBeVisible();
  await otpInput.fill(otp);
  await page.getByRole('button', { name: /verify & continue/i }).click().catch(() => {});
  await expect(page).not.toHaveURL(/#\/auth(?:$|\?)/, { timeout: 30_000 });
}

export function parseMinorUnits(value: unknown): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new Error(`Invalid financial amount: ${String(value)}`);
  return Math.round(amount * 100);
}
