import { describe, expect, it } from 'vitest';
import {
  assertLicenseAllowsAdminApproval,
  assertLicenseAllowsSellerSubmit,
  type LicenseEligibility,
} from '@/lib/seller-license';
import { pickNotificationRoute, sellerRefundDisputeRoute } from '@/lib/notification-routes';

function el(partial: Partial<LicenseEligibility>): LicenseEligibility {
  return {
    required: true,
    mandatory: true,
    reason: 'missing',
    hasApproved: false,
    hasPending: false,
    hasRejected: false,
    hasExpiredOnly: false,
    ...partial,
  };
}

describe('seller license eligibility gates', () => {
  it('allows admin approval when license not mandatory', () => {
    expect(() =>
      assertLicenseAllowsAdminApproval(el({ mandatory: false, reason: 'not_required' })),
    ).not.toThrow();
  });

  it('allows admin approval for pending (auto-approve path)', () => {
    expect(() =>
      assertLicenseAllowsAdminApproval(el({ reason: 'ok_pending_for_admin_approval', hasPending: true })),
    ).not.toThrow();
  });

  it('blocks admin approval when mandatory license missing', () => {
    expect(() => assertLicenseAllowsAdminApproval(el({ reason: 'missing', message: 'missing license' }))).toThrow(
      /missing license/,
    );
  });

  it('blocks seller submit when mandatory license missing', () => {
    expect(() => assertLicenseAllowsSellerSubmit(el({ reason: 'missing', licenseTypeName: 'FSSAI Certificate' }))).toThrow(
      /Please upload your FSSAI Certificate/,
    );
    expect(() => assertLicenseAllowsSellerSubmit(el({ reason: 'missing', licenseTypeName: 'FSSAI Certificate' }))).toThrow(
      /progress is saved/,
    );
  });

  it('uses seller-facing copy, not admin copy', () => {
    expect(() =>
      assertLicenseAllowsSellerSubmit(el({ reason: 'missing', licenseTypeName: 'Trade License', message: 'Cannot approve: mandatory Trade License is missing. Ask the seller to upload it first.' })),
    ).toThrow(/Please upload your Trade License/);
    expect(() =>
      assertLicenseAllowsSellerSubmit(el({ reason: 'missing', licenseTypeName: 'Trade License', message: 'Cannot approve: mandatory Trade License is missing. Ask the seller to upload it first.' })),
    ).not.toThrow(/Ask the seller/);
  });

  it('allows seller submit with pending license', () => {
    expect(() =>
      assertLicenseAllowsSellerSubmit(el({ reason: 'ok_pending_for_admin_approval', hasPending: true })),
    ).not.toThrow();
  });
});

describe('refund notification routing', () => {
  it('routes seller refund_requested to disputes tab', () => {
    expect(
      sellerRefundDisputeRoute({
        target_role: 'seller',
        status: 'refund_requested',
        refundId: 'abc',
      }),
    ).toBe('/seller?tab=refunds&refundId=abc');
  });

  it('routes refund_request type even when stored as order historically', () => {
    expect(
      pickNotificationRoute({
        type: 'order',
        payload: {
          target_role: 'seller',
          status: 'refund_requested',
          refundId: 'r1',
          orderId: 'o1',
        },
        reference_path: '/orders/o1',
      }),
    ).toBe('/seller?tab=refunds&refundId=r1');
  });

  it('routes new refund_request notification type', () => {
    expect(
      pickNotificationRoute({
        type: 'refund_request',
        payload: { refundId: 'r2', target_role: 'seller', status: 'refund_requested' },
      }),
    ).toBe('/seller?tab=refunds&refundId=r2');
  });
});
