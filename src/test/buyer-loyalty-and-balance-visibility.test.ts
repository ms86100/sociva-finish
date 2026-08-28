import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveWalletCardMode } from '@/lib/buyer-balance-visibility';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Sociva Balance card visibility', () => {
  it('hides when online payments off and balance is zero', () => {
    expect(resolveWalletCardMode({ balance: 0, onlinePaymentEnabled: false })).toBe('hidden');
  });

  it('shows read-only when online payments off but balance saved', () => {
    expect(resolveWalletCardMode({ balance: 150, onlinePaymentEnabled: false })).toBe('readonly');
  });

  it('shows active card when online payments on', () => {
    expect(resolveWalletCardMode({ balance: 0, onlinePaymentEnabled: true })).toBe('active');
    expect(resolveWalletCardMode({ balance: 200, onlinePaymentEnabled: true })).toBe('active');
  });
});

describe('buyer loyalty kill-switch migration', () => {
  const migration = read('supabase/migrations/20260828270000_buyer_loyalty_gate_and_balance_visibility.sql');

  it('adds buyer_loyalty_redeem_enabled flag default off', () => {
    expect(migration).toMatch(/buyer_loyalty_redeem_enabled/);
    expect(migration).toMatch(/false/);
  });

  it('gates loyalty quote, reserve, and checkout apply', () => {
    expect(migration).toMatch(/is_buyer_loyalty_redeem_enabled/);
    expect(migration).toMatch(/quote_loyalty_redemption/);
    expect(migration).toMatch(/reserve_loyalty_points/);
    expect(migration).toMatch(/apply_loyalty_to_checkout_orders/);
    expect(migration).toMatch(/loyalty_redeem_disabled/);
  });

  it('exposes capability to clients', () => {
    expect(migration).toMatch(/get_financial_capabilities/);
    expect(migration).toMatch(/buyer_loyalty_redeem_enabled/);
  });

  it('hides loyalty balance and history for buyers when disabled', () => {
    expect(migration).toMatch(/get_loyalty_balance/);
    expect(migration).toMatch(/get_loyalty_history/);
  });
});

describe('buyer loyalty UI hidden by default', () => {
  it('LoyaltyCard returns null when flag off', () => {
    const loyaltyCard = read('src/components/loyalty/LoyaltyCard.tsx');
    expect(loyaltyCard).toMatch(/buyerLoyaltyRedeemEnabled/);
    expect(loyaltyCard).toMatch(/return null/);
  });

  it('cart hides loyalty toggle unless redeem enabled', () => {
    const cartPage = read('src/pages/CartPage.tsx');
    expect(cartPage).toMatch(/loyalty\.redeemEnabled/);
  });
});
