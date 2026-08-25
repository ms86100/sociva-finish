import { describe, it, expect } from 'vitest';
import { resolvePaymentConfig } from '@/lib/resolvePaymentConfig';
import {
  requiresSellerUpi,
  isUpiRequiredAndMissing,
  shouldShowSellerUpiField,
  canGoLiveWithPayments,
} from '@/lib/sellerPaymentReadiness';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('payment gateway mode off (COD-only)', () => {
  const sellerOnline = {
    accepts_upi: true,
    upi_id: 'seller@upi',
    upi_verification_status: 'valid',
    pickup_payment_config: { accepts_cod: true, accepts_online: true },
    delivery_payment_config: { accepts_cod: true, accepts_online: true },
  };

  it('forces acceptsOnline=false when platform mode is off', () => {
    expect(
      resolvePaymentConfig(sellerOnline, 'self_pickup', { isRazorpay: false, isOff: true }).acceptsOnline,
    ).toBe(false);
    expect(
      resolvePaymentConfig(sellerOnline, 'delivery', { isRazorpay: true, isOff: true }).acceptsOnline,
    ).toBe(false);
    expect(
      resolvePaymentConfig(sellerOnline, 'self_pickup', { isRazorpay: false, isOff: true }).acceptsCod,
    ).toBe(true);
  });

  it('still allows online when UPI or Razorpay rail is active', () => {
    expect(
      resolvePaymentConfig(sellerOnline, 'self_pickup', { isRazorpay: false, isOff: false }).acceptsOnline,
    ).toBe(true);
    expect(
      resolvePaymentConfig(sellerOnline, 'delivery', { isRazorpay: true, isOff: false }).acceptsOnline,
    ).toBe(true);
  });

  it('does not require seller UPI when mode is off', () => {
    expect(requiresSellerUpi('off', true)).toBe(false);
    expect(isUpiRequiredAndMissing('off', sellerOnline)).toBe(false);
    expect(shouldShowSellerUpiField('off', sellerOnline)).toBe(false);
    expect(canGoLiveWithPayments('off', { ...sellerOnline, upi_id: '' })).toBe(true);
  });

  it('client + admin surfaces recognize off mode', () => {
    const paymentModeSrc = readFileSync(resolve(__dirname, '../hooks/usePaymentMode.ts'), 'utf8');
    const selectorSrc = readFileSync(
      resolve(__dirname, '../components/payment/PaymentMethodSelector.tsx'),
      'utf8',
    );
    const credentialsSrc = readFileSync(
      resolve(__dirname, '../components/admin/CredentialsManager.tsx'),
      'utf8',
    );
    const cartSrc = readFileSync(resolve(__dirname, '../hooks/useCartPage.ts'), 'utf8');
    const migration = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260825153000_payment_gateway_mode_off.sql'),
      'utf8',
    );

    expect(paymentModeSrc).toMatch(/'off'\s*\|\s*'upi_deep_link'\s*\|\s*'razorpay'/);
    expect(paymentModeSrc).toMatch(/isOff:\s*mode === 'off'/);
    expect(paymentModeSrc).toMatch(/raw === 'off'/);
    expect(selectorSrc).toMatch(/isOff \? \[codMethod\]/);
    expect(credentialsSrc).toMatch(/modeBtn\('off'/);
    expect(cartSrc).toMatch(/paymentMode\.isOff/);
    expect(migration).toMatch(/p_mode NOT IN \('off', 'razorpay', 'upi_deep_link'\)/);
    expect(migration).toMatch(/s\.value IN \('off', 'upi_deep_link', 'razorpay'\)/);
    expect(migration).toMatch(/get_public_payment_mode\(\)/);
    expect(migration).toMatch(/Direct UPI payments are disabled by the platform/);
  });

  it('Razorpay edge create/confirm gate on razorpay mode', () => {
    const createSrc = readFileSync(
      resolve(__dirname, '../../supabase/functions/create-razorpay-order/index.ts'),
      'utf8',
    );
    const confirmSrc = readFileSync(
      resolve(__dirname, '../../supabase/functions/confirm-razorpay-payment/index.ts'),
      'utf8',
    );
    expect(createSrc).toMatch(/getPaymentGatewayMode/);
    expect(createSrc).toMatch(/gatewayMode !== "razorpay"/);
    expect(confirmSrc).toMatch(/getPaymentGatewayMode/);
    expect(confirmSrc).toMatch(/gatewayMode !== "razorpay"/);
    expect(confirmSrc).toMatch(/isService/);
  });
});
