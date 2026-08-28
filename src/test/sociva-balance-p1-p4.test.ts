import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  computeOrderPaymentBreakdown,
  orderGrossForRefund,
  paymentTypeLabel,
  resolveOrderPaymentMethod,
} from '@/lib/order-payment-breakdown';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('order payment breakdown', () => {
  it('computes online + wallet split', () => {
    const b = computeOrderPaymentBreakdown({
      total_amount: 300,
      wallet_cash_amount: 200,
      wallet_promo_amount: 0,
      payment_type: 'online',
    });
    expect(b.orderValue).toBe(500);
    expect(b.socivaBalance).toBe(200);
    expect(b.onlinePayment).toBe(300);
    expect(b.cashToCollect).toBe(0);
    expect(b.isOnline).toBe(true);
  });

  it('computes COD residual only', () => {
    const b = computeOrderPaymentBreakdown({
      total_amount: 500,
      payment_type: 'cod',
    });
    expect(b.cashToCollect).toBe(500);
    expect(b.onlinePayment).toBe(0);
    expect(b.isCod).toBe(true);
  });

  it('order gross for refund includes wallet', () => {
    expect(
      orderGrossForRefund({ total_amount: 300, wallet_cash_amount: 200, wallet_promo_amount: 0 }),
    ).toBe(500);
  });

  it('labels payment types', () => {
    expect(paymentTypeLabel('cod')).toBe('Cash on Delivery');
    expect(paymentTypeLabel('razorpay')).toBe('Online payment');
    expect(resolveOrderPaymentMethod('wallet')).toBe('wallet');
  });
});

describe('P1-P4 hardening migration', () => {
  const migration = read('supabase/migrations/20260828260000_sociva_balance_p1_p4_hardening.sql');

  it('gates quote_wallet_application on platform mode', () => {
    expect(migration).toMatch(/quote_wallet_application/);
    expect(migration).toMatch(/is_online_payment_platform_enabled/);
    expect(migration).toMatch(/wallet_spend_disabled/);
  });

  it('fixes complete_refund gross and Sociva Balance notification', () => {
    expect(migration).toMatch(/v_order_gross/);
    expect(migration).toMatch(/Sociva Balance added/);
    expect(migration).toMatch(/funding_party/);
  });

  it('adds admin dashboard RPC', () => {
    expect(migration).toMatch(/admin_get_sociva_balance_refund_dashboard/);
    expect(migration).toMatch(/cod_wallet_historical_orders/);
  });
});

describe('buyer Sociva Balance UI copy', () => {
  it('uses Sociva Balance in wallet card and cart', () => {
    const walletCard = read('src/components/wallet/WalletCard.tsx');
    const cartPage = read('src/pages/CartPage.tsx');
    expect(walletCard).toMatch(/Sociva Balance/);
    expect(walletCard).not.toMatch(/Sociva Credit/);
    expect(cartPage).toMatch(/Sociva Balance/);
  });
});
