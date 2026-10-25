import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { listingBelongsToMode, type CategoryActionConfig } from '@/lib/commerce-mode';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CONFIGS: CategoryActionConfig[] = [
  { category: 'home_food', transactionType: 'cart_purchase', behavior: { supportsCart: true, enquiryOnly: false } },
  { category: 'salon', transactionType: 'service_booking', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'agarbatti', transactionType: 'contact_enquiry', behavior: { supportsCart: false, enquiryOnly: true } },
];

describe('Order again split by tab', () => {
  const beardTrim = { action_type: 'book', category: 'salon', name: 'Beard trim beard design' };
  const incense = { action_type: 'contact_seller', category: 'agarbatti', name: 'Soothe Your Soul Premium Agarbatti' };

  it('cannot put beard trim on Home Order again and does put it on Book', () => {
    expect(listingBelongsToMode(beardTrim, 'shop', CONFIGS)).toBe(false);
    expect(listingBelongsToMode(beardTrim, 'book', CONFIGS)).toBe(true);
  });

  it('cannot put contact incense on Home and does put it on Contact', () => {
    expect(listingBelongsToMode(incense, 'shop', CONFIGS)).toBe(false);
    expect(listingBelongsToMode(incense, 'services', CONFIGS)).toBe(true);
  });

  it('does not default a missing action_type onto Home', () => {
    expect(listingBelongsToMode({ action_type: null, category: null }, 'shop', CONFIGS)).toBe(false);
    expect(listingBelongsToMode({ action_type: null, category: 'unknown_leaf' }, 'shop', CONFIGS)).toBe(false);
  });

  it('BuyAgainRow filters by mode, uses plus-add only on shop, and names each rail', () => {
    const src = read('src/components/home/BuyAgainRow.tsx');
    expect(src).toMatch(/listingBelongsToMode\(p, mode, categoryConfigs\)/);
    expect(src).toMatch(/title: 'Order again'/);
    expect(src).toMatch(/title: 'Book again'/);
    expect(src).toMatch(/title: 'Contact again'/);
    expect(src).toMatch(/mode === 'shop'/);
    expect(src).toMatch(/await addItem\(/);
    expect(src).toMatch(/CalendarCheck/);
    expect(src).toMatch(/<Phone /);
    expect(src).toMatch(/onOpenListing\?\.\(product\)/);
    expect(src).not.toMatch(/deriveActionType\(/);
  });

  it('keeps Order again on Cart only; Home, Book and Contact send reorder to Orders', () => {
    const home = read('src/components/home/MarketplaceSection.tsx');
    const cart = read('src/pages/CartPage.tsx');
    const modePage = read('src/pages/CommerceModePage.tsx');
    const homePage = read('src/pages/HomePage.tsx');
    expect(home).not.toMatch(/<BuyAgainRow/);
    expect(homePage).not.toMatch(/WelcomeBackStrip/);
    expect(cart).toMatch(/<BuyAgainRow mode="shop" \/>/);
    expect(modePage).not.toMatch(/<BuyAgainRow/);
    expect(modePage).toMatch(/mode === 'book' \|\| mode === 'services'/);
    expect(read('src/pages/OrdersPage.tsx')).toMatch(/<ReorderButton/);
  });

  it('Home nearby chips stay shop-only', () => {
    const home = read('src/components/home/MarketplaceSection.tsx');
    expect(home).toMatch(/filterByMode\(group\.products, 'shop', categoryConfigs\)/);
    expect(home).toMatch(/buildDiscoveryIntents\(localCategoriesWithFacets/);
    expect(home).not.toMatch(/liveCategoryGroups/);
  });

  it('frequent-products RPC returns category and action_type for routing', () => {
    const dir = resolve(process.cwd(), 'supabase/migrations');
    const file = readdirSync(dir).find((f) => f.includes('frequent_products_action_type'));
    expect(file).toBeTruthy();
    const sql = read(`supabase/migrations/${file}`);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.get_user_frequent_products\(uuid, integer\);/);
    expect(sql).toMatch(/category text,/);
    expect(sql).toMatch(/action_type text/);
    expect(sql).toMatch(/p\.category::text/);
    expect(sql).toMatch(/p\.action_type/);
  });
});
