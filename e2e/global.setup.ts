import { test as setup, expect } from '@playwright/test';
import { AuthPage } from './pages/auth.page';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const BUYER_AUTH = path.join(__dirname, '.auth', 'buyer.json');
const SELLER_AUTH = path.join(__dirname, '.auth', 'seller.json');

/**
 * Global setup: authenticate buyer and seller using Phone+OTP bypass,
 * cache storageState so subsequent tests skip login.
 */
setup('authenticate buyer', async ({ page }) => {
  // Seed integration users first
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);
  
  // Trigger the seed function
  await supabase.functions.invoke('seed-integration-test-users');

  const auth = new AuthPage(page);
  await auth.loginWithPhone(
    process.env.TEST_PHONE || '0123456789',
    process.env.TEST_OTP || '1234'
  );
  await page.context().storageState({ path: BUYER_AUTH });
});

// Seller uses email/password from seed-integration-test-users
setup('authenticate seller', async ({ page }) => {
  const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
  await page.goto(`${baseURL}/#/auth`);
  await page.waitForLoadState('networkidle');

  // Use the seeded seller credentials via the auth page
  const auth = new AuthPage(page);
  await auth.loginWithEmail(
    process.env.TEST_SELLER_EMAIL || 'integration-seller@test.sociva.com',
    process.env.TEST_SELLER_PASSWORD || 'TestSeller2026!'
  );
  
  await page.waitForURL(/\/marketplace|\/dashboard/);
  await page.context().storageState({ path: SELLER_AUTH });
});
