import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  resolveTransactionType,
  healOrderTransactionType,
  resolveCartOrderTransactionType,
  resolveEnquiryTransactionType,
} from '@/lib/resolveTransactionType';

const enquiryMigration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260822045911_fix_enquiry_workflow_not_service_booking.sql'),
  'utf8',
);

describe('resolveTransactionType heal', () => {
  it('heals cart_purchase + seller delivery → seller_delivery', () => {
    expect(
      healOrderTransactionType('cart_purchase', 'delivery', 'seller'),
    ).toBe('seller_delivery');
    expect(
      resolveTransactionType('food_beverages', 'purchase', 'delivery', 'seller', null, 'cart_purchase'),
    ).toBe('seller_delivery');
  });

  it('heals cart_purchase + self_pickup → self_fulfillment', () => {
    expect(
      healOrderTransactionType('cart_purchase', 'self_pickup', 'seller'),
    ).toBe('self_fulfillment');
    expect(
      resolveTransactionType('default', 'purchase', 'self_pickup', null, null, 'cart_purchase'),
    ).toBe('self_fulfillment');
  });

  it('keeps platform cart_purchase', () => {
    expect(
      healOrderTransactionType('cart_purchase', 'delivery', 'platform'),
    ).toBe('cart_purchase');
    expect(
      resolveTransactionType('default', 'purchase', 'delivery', 'platform', null, 'cart_purchase'),
    ).toBe('cart_purchase');
  });

  it('does not map enquiry to service_booking in the workflow migration', () => {
    expect(enquiryMigration).toContain('resolve_enquiry_transaction_type');
    expect(enquiryMigration).toContain('heal_enquiry_transaction_type');
    expect(enquiryMigration).not.toMatch(
      /education_learning['\s,)]+.*service_booking/,
    );
    expect(enquiryMigration).not.toContain("THEN _txn_type := 'book_slot'");
  });

  it('maps every enquiry to request_service, including education/events', () => {
    expect(resolveEnquiryTransactionType('product')).toBe('request_service');
    expect(resolveEnquiryTransactionType('contact_only')).toBe('contact_enquiry');
    expect(
      resolveTransactionType('education_learning', 'enquiry', 'self_pickup'),
    ).toBe('request_service');
    expect(
      resolveTransactionType('events', 'enquiry', null, null, 'product'),
    ).toBe('request_service');
    expect(
      resolveTransactionType('education_learning', 'enquiry', 'self_pickup', null, 'product', 'service_booking'),
    ).toBe('request_service');
  });

  it('stamps new cart orders by fulfillment', () => {
    expect(resolveCartOrderTransactionType('delivery', 'seller')).toBe('seller_delivery');
    expect(resolveCartOrderTransactionType('delivery', 'platform')).toBe('cart_purchase');
    expect(resolveCartOrderTransactionType('self_pickup', null)).toBe('self_fulfillment');
  });
});
