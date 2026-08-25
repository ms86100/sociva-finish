import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  wantsOnlinePayments,
  hasSellerUpiId,
  requiresSellerUpi,
  isUpiRequiredAndMissing,
  shouldShowSellerUpiField,
  shouldValidateUpiOnSettingsSave,
  isSettingsSaveBlockedForMissingUpi,
  canGoLiveWithPayments,
} from '@/lib/sellerPaymentReadiness';

const onlineNoUpi = {
  upi_id: '',
  accepts_upi: false,
  pickup_payment_config: { accepts_cod: true, accepts_online: true },
  delivery_payment_config: { accepts_cod: true, accepts_online: false },
};

const cashOnly = {
  upi_id: '',
  accepts_upi: false,
  pickup_payment_config: { accepts_cod: true, accepts_online: false },
  delivery_payment_config: { accepts_cod: true, accepts_online: false },
};

const onlineWithUpi = {
  ...onlineNoUpi,
  upi_id: 'seller@okaxis',
  accepts_upi: true,
};

describe('sellerPaymentReadiness', () => {
  it('treats payment-config online as wanting online even when accepts_upi is stale false', () => {
    expect(wantsOnlinePayments(onlineNoUpi)).toBe(true);
    expect(wantsOnlinePayments(cashOnly)).toBe(false);
    expect(wantsOnlinePayments({ accepts_upi: true, upi_id: '' })).toBe(true);
  });

  it('requires UPI only for Deep UPI + online', () => {
    expect(requiresSellerUpi('upi_deep_link', true)).toBe(true);
    expect(requiresSellerUpi('upi_deep_link', false)).toBe(false);
    expect(requiresSellerUpi('razorpay', true)).toBe(false);
    expect(requiresSellerUpi('razorpay', false)).toBe(false);
    expect(requiresSellerUpi('off', true)).toBe(false);
  });

  it('blocks missing UPI only when Deep UPI collection actually needs it', () => {
    expect(isUpiRequiredAndMissing('upi_deep_link', onlineNoUpi)).toBe(true);
    expect(isUpiRequiredAndMissing('upi_deep_link', onlineWithUpi)).toBe(false);
    expect(isUpiRequiredAndMissing('upi_deep_link', cashOnly)).toBe(false);
    expect(isUpiRequiredAndMissing('razorpay', onlineNoUpi)).toBe(false);
    expect(isUpiRequiredAndMissing('off', onlineNoUpi)).toBe(false);
  });

  it('shows the UPI field only when Deep UPI and online are both on', () => {
    expect(shouldShowSellerUpiField('upi_deep_link', onlineNoUpi)).toBe(true);
    expect(shouldShowSellerUpiField('upi_deep_link', cashOnly)).toBe(false);
    expect(shouldShowSellerUpiField('razorpay', onlineNoUpi)).toBe(false);
    expect(shouldShowSellerUpiField('off', onlineNoUpi)).toBe(false);
  });

  it('never validates UPI on Hours / general settings save', () => {
    expect(shouldValidateUpiOnSettingsSave('hours')).toBe(false);
    expect(shouldValidateUpiOnSettingsSave('general')).toBe(false);
    expect(shouldValidateUpiOnSettingsSave('payments')).toBe(true);
  });

  it('treats whitespace-only UPI as missing', () => {
    expect(hasSellerUpiId({ upi_id: '   ' })).toBe(false);
    expect(hasSellerUpiId({ upi_id: 'store@upi' })).toBe(true);
  });

  describe('vacation / hours save never requires UPI or bank', () => {
    const cases = [
      { name: 'no UPI + online on', seller: onlineNoUpi, mode: 'upi_deep_link' as const },
      { name: 'cash only', seller: cashOnly, mode: 'upi_deep_link' as const },
      { name: 'Deep UPI ready', seller: onlineWithUpi, mode: 'upi_deep_link' as const },
      { name: 'Razorpay online without UPI', seller: onlineNoUpi, mode: 'razorpay' as const },
      { name: 'missing bank (bank is not in readiness)', seller: { ...onlineNoUpi, upi_id: '' }, mode: 'upi_deep_link' as const },
    ];

    it.each(cases)('Hours save is not blocked: $name', ({ seller, mode }) => {
      expect(isSettingsSaveBlockedForMissingUpi('hours', mode, seller)).toBe(false);
      expect(isSettingsSaveBlockedForMissingUpi('general', mode, seller)).toBe(false);
    });

    it('Payments save is blocked only for Deep UPI + online + missing VPA', () => {
      expect(isSettingsSaveBlockedForMissingUpi('payments', 'upi_deep_link', onlineNoUpi)).toBe(true);
      expect(isSettingsSaveBlockedForMissingUpi('payments', 'upi_deep_link', cashOnly)).toBe(false);
      expect(isSettingsSaveBlockedForMissingUpi('payments', 'upi_deep_link', onlineWithUpi)).toBe(false);
      expect(isSettingsSaveBlockedForMissingUpi('payments', 'razorpay', onlineNoUpi)).toBe(false);
    });
  });

  describe('go-live matrix', () => {
    it('blocks Deep UPI + online + no UPI', () => {
      expect(canGoLiveWithPayments('upi_deep_link', onlineNoUpi)).toBe(false);
    });

    it('allows cash-only, Razorpay online without UPI, and Deep UPI with VPA', () => {
      expect(canGoLiveWithPayments('upi_deep_link', cashOnly)).toBe(true);
      expect(canGoLiveWithPayments('razorpay', onlineNoUpi)).toBe(true);
      expect(canGoLiveWithPayments('upi_deep_link', onlineWithUpi)).toBe(true);
    });
  });
});

describe('seller payment / vacation source contracts', () => {
  const settingsHook = readFileSync(resolve(__dirname, '../hooks/useSellerSettings.ts'), 'utf8');
  const settingsPage = readFileSync(resolve(__dirname, '../pages/SellerSettingsPage.tsx'), 'utf8');
  const application = readFileSync(resolve(__dirname, '../hooks/useSellerApplication.ts'), 'utf8');
  const becomeSeller = readFileSync(resolve(__dirname, '../pages/BecomeSellerPage.tsx'), 'utf8');
  const dashboard = readFileSync(resolve(__dirname, '../pages/SellerDashboardPage.tsx'), 'utf8');
  const health = readFileSync(resolve(__dirname, '../hooks/queries/useSellerHealth.ts'), 'utf8');

  it('Hours/Vacation save skips UPI validation', () => {
    expect(settingsHook).toMatch(/shouldValidateUpiOnSettingsSave\(scope\)/);
    expect(settingsPage).toMatch(/saveScopeForTab/);
    expect(settingsPage).toMatch(/tab === 'hours'\) return 'hours'/);
    expect(settingsHook).not.toMatch(/if \(wantsOnlinePay && !formData\.upi_id\.trim\(\)\)/);
  });

  it('Payments-only UPI errors use the readiness title, not Action not allowed', () => {
    expect(settingsHook).toMatch(/UPI_REQUIRED_TITLE/);
    expect(settingsHook).toMatch(/UPI_REQUIRED_FOR_ONLINE_MESSAGE/);
    expect(dashboard).toMatch(/UPI_REQUIRED_FOR_GO_LIVE_MESSAGE/);
  });

  it('shows UPI only for Deep UPI + online and keeps bank optional on the merged Payments tab', () => {
    expect(settingsPage).toMatch(/shouldShowSellerUpiField\(paymentMode\.mode, formData\)/);
    expect(settingsPage).toMatch(/How customers pay you/);
    expect(settingsPage).toMatch(/How you get paid/);
    expect(settingsPage).toMatch(/\(optional\)/);
    expect(settingsPage).not.toMatch(/key: 'payouts'/);
    expect(settingsPage).toMatch(/turn off Online Payment and use cash/);
  });

  it('new-seller defaults do not force online / UPI', () => {
    expect(settingsHook).toMatch(/accepts_online: false/);
    expect(application).toMatch(/accepts_online: false/);
    expect(becomeSeller).toMatch(/pickup_payment_config: \{ \.\.\.formData\.pickup_payment_config, accepts_online: checked \}/);
  });

  it('go-live and health use the same readiness helper', () => {
    expect(settingsHook).toMatch(/isUpiRequiredAndMissing/);
    expect(dashboard).toMatch(/isUpiRequiredAndMissing/);
    expect(health).toMatch(/isUpiRequiredAndMissing/);
  });
});
