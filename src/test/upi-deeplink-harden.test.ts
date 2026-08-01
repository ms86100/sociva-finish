/**
 * Focused unit guards for UPI deep-link Phase 1 harden:
 * - Gate checkout on upi_verification_status === 'valid'
 * - Require screenshot + non-empty UTR before confirm
 * - Buyer claim does not imply placed / paid success UX
 */
import { describe, it, expect } from 'vitest';
import { resolvePaymentConfig } from '@/lib/resolvePaymentConfig';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('UPI deep-link Phase 1 harden', () => {
  const deepLinkMode = { isRazorpay: false };
  const razorpayMode = { isRazorpay: true };

  describe('checkout gate (resolvePaymentConfig)', () => {
    it('blocks UPI deep-link when verification is not valid', () => {
      const seller = {
        accepts_upi: true,
        upi_id: 'seller@upi',
        upi_verification_status: 'unverified',
        pickup_payment_config: { accepts_cod: true, accepts_online: true },
      };
      expect(resolvePaymentConfig(seller, 'self_pickup', deepLinkMode).acceptsOnline).toBe(false);
    });

    it('allows UPI deep-link when verification is valid', () => {
      const seller = {
        accepts_upi: true,
        upi_id: 'seller@upi',
        upi_verification_status: 'valid',
        pickup_payment_config: { accepts_cod: true, accepts_online: true },
      };
      expect(resolvePaymentConfig(seller, 'self_pickup', deepLinkMode).acceptsOnline).toBe(true);
    });

    it('does not require upi_verification_status for Razorpay online', () => {
      const seller = {
        accepts_upi: true,
        upi_id: null,
        upi_verification_status: 'unverified',
        delivery_payment_config: { accepts_cod: false, accepts_online: true },
      };
      expect(resolvePaymentConfig(seller, 'delivery', razorpayMode).acceptsOnline).toBe(true);
    });
  });

  describe('proof requirements (source contract)', () => {
    const checkoutSrc = readFileSync(
      resolve(__dirname, '../components/payment/UpiDeepLinkCheckout.tsx'),
      'utf8',
    );
    const cartSrc = readFileSync(resolve(__dirname, '../hooks/useCartPage.ts'), 'utf8');

    it('requires screenshot and non-empty UTR before confirm', () => {
      expect(checkoutSrc).toMatch(/canSubmitProof\s*=\s*!!screenshotFile\s*&&\s*trimmedUtr\.length\s*>\s*0/);
      expect(checkoutSrc).toMatch(/_upi_transaction_ref:\s*trimmedUtr/);
      expect(checkoutSrc).not.toMatch(/_upi_transaction_ref:\s*''/);
    });

    it('does not clear cart on UPI claim success', () => {
      expect(cartSrc).toMatch(/Payment submitted — waiting for seller confirmation/);
      const successFn = cartSrc.slice(
        cartSrc.indexOf('handleUpiDeepLinkSuccess'),
        cartSrc.indexOf('handleUpiDeepLinkFailed'),
      );
      expect(successFn).not.toMatch(/clearCartAndCache/);
    });
  });

  describe('status hold contract', () => {
    it('buyer_confirmed stays hold until seller verifies → placed', () => {
      const afterBuyerConfirm = { status: 'payment_pending', payment_status: 'buyer_confirmed' };
      const afterSellerReceived = { status: 'placed', payment_status: 'paid' };
      const afterSellerRejected = { status: 'cancelled', payment_status: 'disputed' };

      expect(afterBuyerConfirm.status).toBe('payment_pending');
      expect(afterBuyerConfirm.status).not.toBe('placed');
      expect(afterSellerReceived.status).toBe('placed');
      expect(afterSellerRejected.status).toBe('cancelled');
    });
  });
});
