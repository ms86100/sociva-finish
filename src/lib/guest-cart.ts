/**
 * Guest (logged-out) cart - Swiggy-style local cart until checkout OTP.
 * Merged into server cart_items after login.
 * A line is identified by product and size (variant_id null for products without sizes).
 */

import type { CartItem, Product } from '@/types/Database';
import { normalizeGuestProductSeller } from '@/lib/guest-cart-enrich';
import { applyVariantToProduct, type ProductVariant } from '@/lib/product-variants';

const STORAGE_KEY = 'sociva_guest_cart_v2';
const LEGACY_STORAGE_KEY = 'sociva_guest_cart_v1';

export type GuestCartLine = {
  product_id: string;
  variant_id?: string | null;
  variant?: ProductVariant | null;
  quantity: number;
  selected_extras?: unknown[];
  product: Product;
};

function isValidLine(row: any): boolean {
  return (
    row &&
    typeof row.product_id === 'string' &&
    typeof row.quantity === 'number' &&
    row.quantity > 0 &&
    row.product &&
    typeof row.product === 'object'
  );
}

function sameLine(row: GuestCartLine, productId: string, variantId?: string | null): boolean {
  return row.product_id === productId && (row.variant_id ?? null) === (variantId ?? null);
}

function parse(raw: string | null): GuestCartLine[] | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidLine).map((row) => ({ ...row, variant_id: row.variant_id ?? null })) as GuestCartLine[];
}

function loadRaw(): GuestCartLine[] {
  try {
    const current = parse(localStorage.getItem(STORAGE_KEY));
    if (current) return current;
    // v1 lines had no sizes; carry them over once as variant_id null.
    const legacy = parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      if (legacy.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      return legacy;
    }
    return [];
  } catch {
    return [];
  }
}

function saveRaw(lines: GuestCartLine[]): void {
  try {
    if (lines.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // ignore quota / private mode
  }
}

export function readGuestCart(): GuestCartLine[] {
  return loadRaw();
}

export function guestCartItemCount(lines: GuestCartLine[] = loadRaw()): number {
  return lines.reduce((sum, row) => sum + (row.quantity || 0), 0);
}

export function guestCartToItems(lines: GuestCartLine[] = loadRaw()): (CartItem & { product: Product })[] {
  return lines.map((row) => {
    const base = (normalizeGuestProductSeller(row.product) || row.product) as Product;
    return {
      id: row.variant_id ? `guest-${row.product_id}-${row.variant_id}` : `guest-${row.product_id}`,
      user_id: 'guest',
      product_id: row.product_id,
      variant_id: row.variant_id ?? null,
      variant: row.variant ?? null,
      quantity: row.quantity,
      created_at: new Date().toISOString(),
      society_id: null,
      selected_extras: Array.isArray(row.selected_extras) ? row.selected_extras : [],
      product: applyVariantToProduct(base, row.variant) as Product,
    };
  }) as (CartItem & { product: Product })[];
}

export function writeGuestCart(lines: GuestCartLine[]): void {
  saveRaw(lines);
  notifyGuestCartChanged();
}

export function clearGuestCart(): void {
  saveRaw([]);
  notifyGuestCartChanged();
}

function notifyGuestCartChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('sociva:guest-cart'));
  } catch {
    // ignore
  }
}

export function upsertGuestCartItem(
  product: Product,
  quantity: number,
  extras: unknown[] = [],
  variant: ProductVariant | null = null,
): GuestCartLine[] {
  const normalized = (normalizeGuestProductSeller(product) || product) as Product;
  const lines = loadRaw();
  const extrasPayload = Array.isArray(extras) ? extras : [];
  const variantId = variant?.id ?? null;
  const idx = lines.findIndex((row) => sameLine(row, product.id, variantId));
  if (idx >= 0) {
    lines[idx] = {
      ...lines[idx],
      quantity: lines[idx].quantity + quantity,
      product: normalized,
      ...(variant ? { variant } : {}),
      ...(extrasPayload.length ? { selected_extras: extrasPayload } : {}),
    };
  } else {
    lines.push({
      product_id: product.id,
      variant_id: variantId,
      variant,
      quantity,
      product: normalized,
      selected_extras: extrasPayload,
    });
  }
  writeGuestCart(lines);
  return lines;
}

export function setGuestCartQuantity(productId: string, quantity: number, variantId: string | null = null): GuestCartLine[] {
  let lines = loadRaw();
  if (quantity <= 0) {
    lines = lines.filter((row) => !sameLine(row, productId, variantId));
  } else {
    lines = lines.map((row) =>
      sameLine(row, productId, variantId) ? { ...row, quantity } : row,
    );
  }
  writeGuestCart(lines);
  return lines;
}

export function removeGuestCartItem(productId: string, variantId: string | null = null): GuestCartLine[] {
  const lines = loadRaw().filter((row) => !sameLine(row, productId, variantId));
  writeGuestCart(lines);
  return lines;
}

export function guestCartHasItems(): boolean {
  return loadRaw().length > 0;
}
