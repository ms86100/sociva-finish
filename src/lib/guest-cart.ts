/**
 * Guest (logged-out) cart — Swiggy-style local cart until checkout OTP.
 * Merged into server cart_items after login.
 */

import type { CartItem, Product } from '@/types/Database';

const STORAGE_KEY = 'sociva_guest_cart_v1';

export type GuestCartLine = {
  product_id: string;
  quantity: number;
  selected_extras?: unknown[];
  product: Product;
};

function loadRaw(): GuestCartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row) =>
        row &&
        typeof row.product_id === 'string' &&
        typeof row.quantity === 'number' &&
        row.quantity > 0 &&
        row.product &&
        typeof row.product === 'object',
    ) as GuestCartLine[];
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
  return lines.map((row) => ({
    id: `guest-${row.product_id}`,
    user_id: 'guest',
    product_id: row.product_id,
    quantity: row.quantity,
    created_at: new Date().toISOString(),
    society_id: null,
    selected_extras: Array.isArray(row.selected_extras) ? row.selected_extras : [],
    product: row.product,
  })) as (CartItem & { product: Product })[];
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
): GuestCartLine[] {
  const lines = loadRaw();
  const extrasPayload = Array.isArray(extras) ? extras : [];
  const idx = lines.findIndex((row) => row.product_id === product.id);
  if (idx >= 0) {
    lines[idx] = {
      ...lines[idx],
      quantity: lines[idx].quantity + quantity,
      product,
      ...(extrasPayload.length ? { selected_extras: extrasPayload } : {}),
    };
  } else {
    lines.push({
      product_id: product.id,
      quantity,
      product,
      selected_extras: extrasPayload,
    });
  }
  writeGuestCart(lines);
  return lines;
}

export function setGuestCartQuantity(productId: string, quantity: number): GuestCartLine[] {
  let lines = loadRaw();
  if (quantity <= 0) {
    lines = lines.filter((row) => row.product_id !== productId);
  } else {
    lines = lines.map((row) =>
      row.product_id === productId ? { ...row, quantity } : row,
    );
  }
  writeGuestCart(lines);
  return lines;
}

export function removeGuestCartItem(productId: string): GuestCartLine[] {
  const lines = loadRaw().filter((row) => row.product_id !== productId);
  writeGuestCart(lines);
  return lines;
}

export function guestCartHasItems(): boolean {
  return loadRaw().length > 0;
}
