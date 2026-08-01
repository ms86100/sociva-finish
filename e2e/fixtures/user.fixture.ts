import { test as base } from './base.fixture';
import type { Page } from '@playwright/test';
import path from 'path';

const BUYER_AUTH = path.join(__dirname, '..', '.auth', 'buyer.json');
const SELLER_AUTH = path.join(__dirname, '..', '.auth', 'seller.json');

/**
 * Provides pre-authenticated buyer and seller pages via cached storageState.
 */
export const test = base.extend<{
  buyerPage: Page;
  sellerPage: Page;
}>({
  buyerPage: async ({ browser, db }, use) => {
    const context = await browser.newContext({ storageState: BUYER_AUTH });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  sellerPage: async ({ browser, db }, use) => {
    const context = await browser.newContext({ storageState: SELLER_AUTH });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
