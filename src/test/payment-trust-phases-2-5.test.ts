/**
 * Phases 2–5 payment/trust guards (extends Phase 1 upi-deeplink harden).
 */
import { describe, it, expect } from 'vitest';
import { deriveDisplayStatus } from '@/lib/deriveDisplayStatus';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Phase 2–5 payment/trust', () => {
  describe('Phase 3 status honesty (deriveDisplayStatus)', () => {
    it('unpaid payment_pending is not "Order placed"', () => {
      const result = deriveDisplayStatus({
        orderStatus: 'payment_pending',
        flow: [],
        isBuyerView: true,
      });
      expect(result.text).toBe('Complete your payment');
      expect(result.text).not.toMatch(/Order placed/i);
    });

    it('awaiting_cod_confirmation is not "Confirming payment…" / unpaid hold', () => {
      const result = deriveDisplayStatus({
        orderStatus: 'awaiting_cod_confirmation',
        flow: [],
        isBuyerView: true,
      });
      expect(result.text).toBe('Waiting for cash confirmation');
      expect(result.text).not.toMatch(/Confirming payment/i);
      expect(result.text).not.toBe('Complete your payment');
    });

    it('seller sees cash confirm CTA copy for awaiting_cod_confirmation', () => {
      const result = deriveDisplayStatus({
        orderStatus: 'awaiting_cod_confirmation',
        flow: [],
        isBuyerView: false,
      });
      expect(result.text).toBe('Confirm cash received');
    });

    it('placed still reads as order placed', () => {
      const result = deriveDisplayStatus({
        orderStatus: 'placed',
        flow: [{ status_key: 'placed', sort_order: 10 }],
        isBuyerView: true,
      });
      expect(result.text).toBe('Order placed');
    });
  });

  describe('Phase 4 Razorpay webhook fail-closed (source)', () => {
    const webhookSrc = readFileSync(
      resolve(__dirname, '../../supabase/functions/razorpay-webhook/index.ts'),
      'utf8',
    );
    const credsSrc = readFileSync(
      resolve(__dirname, '../components/admin/CredentialsManager.tsx'),
      'utf8',
    );

    it('does not fall back to razorpay_key_secret for HMAC', () => {
      expect(webhookSrc).not.toMatch(/Using razorpay_key_secret as HMAC fallback/);
      expect(webhookSrc).toMatch(/razorpay_webhook_secret missing or inactive/);
      expect(webhookSrc).toMatch(/\.eq\('key',\s*'razorpay_webhook_secret'\)/);
    });

    it('blocks switching to razorpay without active webhook secret', () => {
      expect(credsSrc).toMatch(/webhookSecretSet/);
      expect(credsSrc).toMatch(/Add and activate Razorpay webhook secret/);
      expect(credsSrc).toMatch(/webhook secret is empty/i);
    });
  });

  describe('Phase 5 seller readiness (source)', () => {
    const healthSrc = readFileSync(
      resolve(__dirname, '../hooks/queries/useSellerHealth.ts'),
      'utf8',
    );
    const settingsSrc = readFileSync(
      resolve(__dirname, '../hooks/useSellerSettings.ts'),
      'utf8',
    );
    const dashSrc = readFileSync(
      resolve(__dirname, '../pages/SellerDashboardPage.tsx'),
      'utf8',
    );

    it('readiness checklist includes UPI verification for online payments', () => {
      expect(healthSrc).toMatch(/upi_verified/);
      expect(healthSrc).toMatch(/UPI verification required/);
    });

    it('go-live gates on verified UPI when online payments enabled', () => {
      expect(settingsSrc).toMatch(/Verify your UPI ID before going live/);
      expect(dashSrc).toMatch(/Verify your UPI ID before going live/);
      expect(dashSrc).toMatch(/upi_verification_status/);
    });
  });

  describe('Phase 2 auto-cancel contract (source)', () => {
    const mig = readFileSync(
      resolve(
        __dirname,
        '../../supabase/migrations/20260801160000_safe_unpaid_auto_cancel_phase2.sql',
      ),
      'utf8',
    );

    it('uses 45 minute window and skips buyer_confirmed', () => {
      expect(mig).toMatch(/45 minutes/);
      expect(mig).toMatch(/payment_status = 'pending'/);
      expect(mig).toMatch(/auto_cancel_expired_unpaid_orders/);
      expect(mig).toMatch(/\*\/10 \* \* \* \*/);
    });
  });
});
