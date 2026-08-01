import { type Page, expect } from '@playwright/test';

/**
 * Auth Page Object — handles Phone+OTP login flow.
 * Uses Apple Review bypass (0123456789 / 1234).
 */
export class AuthPage {
  constructor(private page: Page) {}

  async goto() {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/auth`);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Full Phone+OTP login flow:
   * 1. Navigate to auth page
   * 2. Enter phone number
   * 3. Check age confirmation
   * 4. Send OTP
   * 5. Enter OTP digits
   * 6. Verify & wait for redirect
   */
  async loginWithPhone(phone: string, otp: string) {
    await this.goto();

    // Enter phone number — look for phone input field
    const phoneInput = this.page.locator('input[type="tel"], input[placeholder*="phone"], input[placeholder*="Phone"], input[name="phone"]').first();
    await phoneInput.waitFor({ state: 'visible', timeout: 15_000 });
    await phoneInput.fill(phone);

    // Check age confirmation if present
    const ageCheckbox = this.page.locator('button[role="checkbox"], input[type="checkbox"]').first();
    if (await ageCheckbox.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const isChecked = await ageCheckbox.getAttribute('data-state');
      if (isChecked !== 'checked') {
        await ageCheckbox.click();
      }
    }

    // Click Send OTP button
    const sendOTPBtn = this.page.locator('button:has-text("Send OTP"), button:has-text("Get OTP"), button:has-text("Continue")').first();
    await sendOTPBtn.click();

    // Wait for OTP input screen
    await this.page.waitForTimeout(1_000); // Brief wait for transition

    // Enter OTP digits (4 separate inputs)
    const otpInputs = this.page.locator('input[maxlength="1"], input[data-otp="true"]');
    const otpCount = await otpInputs.count();

    if (otpCount >= 4) {
      // Individual digit inputs
      for (let i = 0; i < otp.length && i < otpCount; i++) {
        await otpInputs.nth(i).fill(otp[i]);
      }
    } else {
      // Single OTP input field
      const singleOTP = this.page.locator('input[type="text"], input[type="number"]').first();
      await singleOTP.fill(otp);
    }

    // Click Verify button
    const verifyBtn = this.page.locator('button:has-text("Verify"), button:has-text("Submit"), button:has-text("Login")').first();
    if (await verifyBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await verifyBtn.click();
    }

    // Wait for redirect away from auth page
    await this.page.waitForURL((url) => !url.hash.includes('/auth'), {
      timeout: 20_000,
    });
  }

  async isLoggedIn(): Promise<boolean> {
    const url = this.page.url();
    return !url.includes('/auth');
  }
}
