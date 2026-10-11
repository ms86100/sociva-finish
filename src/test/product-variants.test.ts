import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  applyVariantToProduct,
  cartLineKey,
  isVariantPurchasable,
  variantErrorMessage,
  type ProductVariant,
} from '@/lib/product-variants';
import { emptySizeRow, lowestActiveSizePrice, previewSizePricing, sizesNeedReview, validateSizeRows, type SizeRow } from '@/lib/seller-product-sizes';
import {
  guestCartToItems,
  readGuestCart,
  removeGuestCartItem,
  setGuestCartQuantity,
  upsertGuestCartItem,
} from '@/lib/guest-cart';
import { resolveReorderLines } from '@/lib/reorder';
import { closeVariantPicker, getVariantPickerRequest, openVariantPicker } from '@/lib/variant-picker-store';
import { extrasFromCartItems } from '@/lib/productExtras';
import { buildSellerGroupsPayload } from '@/lib/checkout-payload';

// Grouped-listing lookups are covered in product-merges.test.ts; keep these offline.
vi.mock('@/lib/product-merges', () => ({ remapMergedLines: async (lines: unknown[]) => lines }));

const variant = (over: Partial<ProductVariant> = {}): ProductVariant => ({
  id: 'v-250',
  product_id: 'p1',
  label: '250 g',
  price: 185,
  compare_at_price: 200,
  stock_quantity: 4,
  low_stock_threshold: null,
  is_active: true,
  sort_order: 0,
  image_url: null,
  archived_at: null,
  ...over,
});

const product = { id: 'p1', seller_id: 's1', name: 'Mango pickle', price: 185, image_url: 'parent.jpg', stock_quantity: null } as any;

const row = (over: Partial<SizeRow>): SizeRow => ({ ...emptySizeRow(), ...over });

afterEach(() => {
  localStorage.clear();
});

describe('cart line identity and size overlay', () => {
  it('keys a line by product and size', () => {
    expect(cartLineKey('p1')).toBe(cartLineKey('p1', null));
    expect(cartLineKey('p1', 'v-250')).not.toBe(cartLineKey('p1', 'v-500'));
  });

  it('prices, stocks and images a line from its size', () => {
    const line = applyVariantToProduct(product, variant({ image_url: 'size.jpg' }));
    expect(line).toMatchObject({ price: 185, mrp: 200, stock_quantity: 4, image_url: 'size.jpg', name: 'Mango pickle' });
    expect(applyVariantToProduct(product, variant()).image_url).toBe('parent.jpg');
    expect(applyVariantToProduct(product, null)).toBe(product);
  });

  it('treats inactive, archived and sold-out sizes as not purchasable', () => {
    expect(isVariantPurchasable(variant())).toBe(true);
    expect(isVariantPurchasable(variant({ stock_quantity: null }))).toBe(true);
    expect(isVariantPurchasable(variant({ stock_quantity: 0 }))).toBe(false);
    expect(isVariantPurchasable(variant({ is_active: false }))).toBe(false);
    expect(isVariantPurchasable(variant({ archived_at: '2026-10-11T00:00:00Z' }))).toBe(false);
  });

  it('maps server size errors to buyer and seller copy', () => {
    expect(variantErrorMessage({ message: 'VARIANT_REQUIRED' })).toMatch(/choose a size/i);
    expect(variantErrorMessage({ message: 'VARIANT_NOT_AVAILABLE' })).toMatch(/no longer available/i);
    expect(variantErrorMessage({ message: 'VARIANT_IN_USE: deactivate this size instead of deleting it' })).toMatch(/Turn it off/);
    expect(variantErrorMessage({ message: "VARIANTS_NOT_SUPPORTED: remove this product's sizes before changing how it is sold" })).toMatch(/before changing how it is sold/);
    expect(variantErrorMessage({ message: 'VARIANTS_NOT_SUPPORTED: sizes are only available for Add to Cart products' })).toMatch(/only available for Add to Cart/);
    expect(variantErrorMessage({ message: 'SIZES_DISABLED' })).toMatch(/not available yet/i);
    expect(variantErrorMessage({ message: 'something else' })).toBeNull();
  });
});

describe('product sizes switch', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

  it('ships switched off and blocks new sizes in the database until an admin turns it on', () => {
    const sql = read('supabase/migrations/20261011190000_product_sizes_switch.sql');
    expect(sql).toMatch(/'product_sizes_enabled',\s*to_jsonb\('false'::text\)/);
    expect(sql).toMatch(/on conflict \(key\) do nothing/);
    expect(sql).toMatch(/before insert on public\.product_variants/);
    expect(sql).toMatch(/raise exception 'SIZES_DISABLED'/);
  });

  it('reads the switch as off unless the setting is exactly true', () => {
    const src = read('src/hooks/useSystemSettings.ts');
    expect(src).toMatch(/productSizesEnabled: false/);
    expect(src).toMatch(/productSizesEnabled: map\.product_sizes_enabled === 'true'/);
  });

  it('seller form offers new sizes only while the switch is on, and keeps existing sizes editable', () => {
    const page = read('src/pages/SellerProductFormPage.tsx');
    expect(page).toMatch(/\(sp\.sizesAllowed && sp\.sizesEnabled\) \|\| sp\.sizeRows\.length > 0/);
    expect(page).toMatch(/onAdd=\{sp\.sizesEnabled \? sp\.addSizeRow : undefined\}/);
    const hook = read('src/hooks/useSellerProducts.ts');
    expect(hook.match(/!sizesEnabled && (sizes|sizeCheck\.sizes)\.some\(\(s\) => !s\.id\)/g)).toHaveLength(2);
  });
});

describe('seller size table validation', () => {
  it('ignores fully blank rows and keeps seller order', () => {
    const { error, sizes } = validateSizeRows([
      row({ label: ' 500 g ', price: '340', stock_quantity: '3' }),
      row({}),
      row({ label: '250 g', price: '185.555', compare_at_price: '200' }),
    ]);
    expect(error).toBeNull();
    expect(sizes.map((s) => [s.label, s.price, s.compare_at_price, s.stock_quantity, s.sort_order])).toEqual([
      ['500 g', 340, null, 3, 0],
      ['250 g', 185.56, 200, null, 1],
    ]);
  });

  it('mirrors the table constraints', () => {
    expect(validateSizeRows([row({ price: '100' })]).error).toMatch(/size name/);
    expect(validateSizeRows([row({ label: 'x'.repeat(41), price: '100' })]).error).toMatch(/40 characters/);
    expect(validateSizeRows([row({ label: '1 kg', price: '0' })]).error).toMatch(/price above 0/);
    expect(validateSizeRows([row({ label: '1 kg', price: '100', compare_at_price: '90' })]).error).toMatch(/MRP/);
    expect(validateSizeRows([row({ label: '1 kg', price: '100', stock_quantity: '-1' })]).error).toMatch(/whole number/);
    expect(validateSizeRows([row({ label: '1 KG', price: '100' }), row({ label: '1 kg', price: '200' })]).error).toMatch(/twice/);
  });

  it('starts the product price at the cheapest size that is on', () => {
    const { sizes } = validateSizeRows([
      row({ label: '250 g', price: '185', is_active: false }),
      row({ label: '500 g', price: '340' }),
      row({ label: '1 kg', price: '640' }),
    ]);
    expect(lowestActiveSizePrice(sizes)).toBe(340);
    expect(lowestActiveSizePrice(sizes.map((s) => ({ ...s, is_active: false })))).toBeNull();
  });

  it('previews the lowest size that is on, and says so when none are', () => {
    expect(previewSizePricing([])).toEqual({ price: null, from: false, hasSizes: false, noneActive: false });
    expect(previewSizePricing([
      row({ label: '200 g', price: '80' }),
      row({ label: '1 kg', price: '340' }),
    ])).toMatchObject({ price: 80, from: true, hasSizes: true, noneActive: false });
    expect(previewSizePricing([
      row({ label: '200 g', price: '80', is_active: false }),
    ])).toMatchObject({ price: null, hasSizes: true, noneActive: true });
  });

  it('sends size name, price and MRP edits to review, but not stock, on/off or order', () => {
    const before = validateSizeRows([
      row({ id: 'a', label: '200 g', price: '80', stock_quantity: '10' }),
      row({ id: 'b', label: '1 kg', price: '340' }),
    ]).sizes;
    const edit = (rows: SizeRow[]) => sizesNeedReview(before, validateSizeRows(rows).sizes);

    expect(edit([
      row({ id: 'b', label: '1 kg', price: '340', is_active: false }),
      row({ id: 'a', label: '200 g', price: '80', stock_quantity: '2' }),
    ])).toBe(false);
    expect(edit([row({ id: 'a', label: '200 g', price: '80' }), row({ id: 'b', label: '1 kg', price: '399' })])).toBe(true);
    expect(edit([row({ id: 'a', label: '200 g', price: '80', compare_at_price: '90' }), row({ id: 'b', label: '1 kg', price: '340' })])).toBe(true);
    expect(edit([row({ id: 'a', label: '250 g', price: '80' }), row({ id: 'b', label: '1 kg', price: '340' })])).toBe(true);
    expect(edit([row({ id: 'a', label: '200 g', price: '80' })])).toBe(true);
  });
});

describe('guest cart with sizes', () => {
  it('keeps each size of a product as its own line', () => {
    upsertGuestCartItem(product, 1, [], variant());
    upsertGuestCartItem(product, 2, [], variant({ id: 'v-500', label: '500 g', price: 340 }));
    upsertGuestCartItem(product, 1, [], variant());
    const lines = readGuestCart();
    expect(lines.map((l) => [l.variant_id, l.quantity])).toEqual([['v-250', 2], ['v-500', 2]]);

    const items = guestCartToItems();
    expect(items.map((i) => i.id)).toEqual(['guest-p1-v-250', 'guest-p1-v-500']);
    expect(items.map((i) => i.product.price)).toEqual([185, 340]);

    setGuestCartQuantity('p1', 5, 'v-500');
    removeGuestCartItem('p1', 'v-250');
    expect(readGuestCart().map((l) => [l.variant_id, l.quantity])).toEqual([['v-500', 5]]);
  });

  it('leaves a no-size line untouched by size operations', () => {
    upsertGuestCartItem(product, 1);
    removeGuestCartItem('p1', 'v-250');
    expect(readGuestCart().map((l) => [l.variant_id, l.quantity])).toEqual([[null, 1]]);
    expect(guestCartToItems()[0].id).toBe('guest-p1');
  });

  it('carries a v1 guest cart over once as no-size lines', () => {
    localStorage.setItem('sociva_guest_cart_v1', JSON.stringify([{ product_id: 'p1', quantity: 3, product }]));
    expect(readGuestCart().map((l) => [l.product_id, l.variant_id, l.quantity])).toEqual([['p1', null, 3]]);
    expect(localStorage.getItem('sociva_guest_cart_v1')).toBeNull();
    expect(readGuestCart()).toHaveLength(1);
  });
});

describe('reorder by size', () => {
  it('keeps size and listed lines without a fetch when nothing is sized', async () => {
    const lines = await resolveReorderLines(
      [{ product_id: 'p1', quantity: 2 }, { product_id: 'p2', quantity: 1, variant_id: 'v-1', unit_price: 120 }],
      null,
      new Set(['p9']),
    );
    expect(lines).toEqual([
      { product_id: 'p1', quantity: 2 },
      { product_id: 'p2', quantity: 1, variant_id: 'v-1', unit_price: 120 },
    ]);
  });
});

describe('size picker carries add-ons', () => {
  afterEach(() => closeVariantPicker());

  it('keeps the add-ons chosen on the detail sheet until the picker closes', () => {
    const extras = [{ id: 'spice', fieldLabel: 'Spice level', value: 'Hot' }] as any;
    openVariantPicker(product, extras);
    expect(getVariantPickerRequest()).toEqual({ product, extras });
    closeVariantPicker();
    expect(getVariantPickerRequest()).toBeNull();
  });

  it('defaults to no add-ons when opened from a card', () => {
    openVariantPicker(product);
    expect(getVariantPickerRequest()?.extras).toEqual([]);
  });

  it('names the size in the add-on note sent with the order', () => {
    const extras = [{ id: 'spice', fieldLabel: 'Spice level', value: 'Hot' }] as any;
    expect(extrasFromCartItems([
      { product: { name: 'Plain Rice' }, variant: { label: 'Full plate' }, selected_extras: extras },
      { product: { name: 'Curd' }, selected_extras: [] },
    ])).toBe('Plain Rice (Full plate)\nSpice level: Hot');
  });

  it('gives each store only its own add-ons and keeps them on the line', () => {
    const extras = [{ id: 'spice', fieldLabel: 'Spice level', value: 'Hot' }] as any;
    const payload = buildSellerGroupsPayload([
      { sellerId: 'a', subtotal: 90, items: [{ product_id: 'rice', variant_id: 'full', quantity: 1, variant: { label: 'Full plate' }, product: { name: 'Plain Rice', price: 90 }, selected_extras: extras }] },
      { sellerId: 'b', subtotal: 40, items: [{ product_id: 'lassi', quantity: 1, product: { name: 'Lassi', price: 40 }, selected_extras: [] }] },
    ], 'Ring the bell');
    expect(payload[0].notes).toBe('Plain Rice (Full plate)\nSpice level: Hot\n\nRing the bell');
    expect(payload[1].notes).toBe('Ring the bell');
    expect(payload[0].items[0]).toMatchObject({ variant_id: 'full', unit_price: 90, selected_extras: extras });
    expect(payload[1].items[0]).not.toHaveProperty('variant_id');
    expect(buildSellerGroupsPayload([{ sellerId: 'b', subtotal: 40, items: [{ product_id: 'x', quantity: 1 }] }], '')[0].notes).toBe('');
  });

  it('carries add-ons with a guest size line', () => {
    const extras = [{ id: 'spice', fieldLabel: 'Spice level', value: 'Mild' }] as any;
    upsertGuestCartItem(product, 1, extras, variant());
    expect(readGuestCart()[0]).toMatchObject({ variant_id: 'v-250', selected_extras: extras });
  });
});
