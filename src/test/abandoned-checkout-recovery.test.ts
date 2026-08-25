import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('abandoned unpaid checkout P0', () => {
  const cartPage = readFileSync(resolve(__dirname, '../pages/CartPage.tsx'), 'utf8');
  const cartHook = readFileSync(resolve(__dirname, '../hooks/useCartPage.ts'), 'utf8');
  const migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20260825160000_unpaid_checkout_auto_cancel_ttl.sql'),
    'utf8',
  );

  it('never shows the stuck pending-payment escape hatch UI', () => {
    expect(cartPage).not.toMatch(/You have an incomplete payment/);
    expect(cartPage).not.toMatch(/Cancel Payment/);
    expect(cartPage).not.toMatch(/Retry Payment/);
    expect(cartPage).toMatch(/isResolvingPaymentSession/);
    expect(cartPage).toMatch(/Clearing a previous unpaid checkout/);
  });

  it('auto-cancels unpaid payment_pending sessions on cart recovery', () => {
    expect(cartHook).toMatch(/Always cancel abandoned unpaid holds on return/);
    expect(cartHook).toMatch(/buyer_cancel_pending_orders/);
    expect(cartHook).toMatch(/Previous unpaid checkout was cancelled/);
    expect(cartHook).toMatch(/isResolvingPaymentSession/);
    expect(cartHook).toMatch(/const \{ error: cancelErr \} = await supabase\.rpc\('buyer_cancel_pending_orders'/);
    expect(cartHook).toMatch(/const \{ error \} = await supabase\.rpc\('buyer_cancel_pending_orders'/);
  });

  it('stamps 45m TTL and sets acting_as for cancel paths', () => {
    expect(migration).toMatch(/stamp_unpaid_online_auto_cancel/);
    expect(migration).toMatch(/interval '45 minutes'/);
    expect(migration).toMatch(/set_config\('app\.acting_as', 'buyer'/);
    expect(migration).toMatch(/set_config\('app\.acting_as', 'system'/);
  });
});
