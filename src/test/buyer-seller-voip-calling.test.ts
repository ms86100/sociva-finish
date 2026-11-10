import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canPlaceOrderCall,
  isOrderStatusCallable,
  ORDER_CALL_HONESTY,
  ORDER_CALL_MAX_DURATION_SECONDS,
  ORDER_CALL_MAX_PER_HOUR,
  ORDER_CALLABLE_STATUSES,
  ORDER_NON_CALLABLE_STATUSES,
} from '@/lib/calling/orderCallPolicy';
import { resolveOrderCall } from '@/lib/calling/resolveCallContext';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('Buyer-seller in-app calling policy', () => {
  const migration = read(
    'supabase/migrations/20261110220000_buyer_seller_voip_order_calling.sql',
  );
  const orderPage = read('src/pages/OrderDetailPage.tsx');
  const contactModal = read('src/components/product/ContactSellerModal.tsx');
  const callButton = read('src/components/calling/CallButton.tsx');
  const ride = read('src/pages/cleaner-city/CleanerCityRidePage.tsx');

  it('allows active commerce, booking, and contact statuses', () => {
    for (const status of ORDER_CALLABLE_STATUSES) {
      expect(isOrderStatusCallable(status)).toBe(true);
      expect(canPlaceOrderCall(status, { can_place_calls: true })).toBe(true);
      expect(canPlaceOrderCall(status, { can_place_calls: false })).toBe(false);
    }
  });

  it('blocks terminal and dead statuses', () => {
    for (const status of ORDER_NON_CALLABLE_STATUSES) {
      expect(isOrderStatusCallable(status)).toBe(false);
      expect(canPlaceOrderCall(status, { can_place_calls: true })).toBe(false);
    }
  });

  it('mirrors allowlist and LiveKit spend caps in SQL', () => {
    expect(migration).toContain("'placed'");
    expect(migration).toContain("'enquired'");
    expect(migration).toContain("'scheduled'");
    expect(migration).toContain("'confirmed'");
    expect(migration).toContain('order_not_callable');
    expect(migration).toContain('call_rate_limited');
    expect(migration).toContain('max_duration');
    expect(migration).toContain("interval '1 hour'");
    expect(migration).toContain("interval '10 minutes'");
    expect(ORDER_CALL_MAX_PER_HOUR).toBe(3);
    expect(ORDER_CALL_MAX_DURATION_SECONDS).toBe(600);
  });

  it('wires CallButton on order detail with resolveOrderCall', () => {
    expect(orderPage).toContain('CallButton');
    expect(orderPage).toContain('resolveOrderCall');
    expect(orderPage).toContain('order-in-app-call-panel');
    expect(orderPage).toContain('canPlaceOrderCall');
    expect(orderPage).toContain('ORDER_CALL_HONESTY');
    expect(ORDER_CALL_HONESTY).toBe('In-app call - numbers stay private');
    expect(resolveOrderCall('oid', false).contextType).toBe('order');
    expect(resolveOrderCall('oid', true).contextType).toBe('seller_order');
  });

  it('routes Contact Seller Call through order_id + startVoipCall', () => {
    expect(contactModal).toContain('startVoipCall');
    expect(contactModal).toContain('resolveOrderCall');
    expect(contactModal).toContain('Call in Sociva');
    expect(contactModal).toContain('ORDER_CALL_HONESTY');
    expect(contactModal).toContain('contact-seller-call');
  });

  it('keeps Green City ride calling and uses LiveKit honesty copy', () => {
    expect(ride).toContain('CallButton');
    expect(ride).toContain('resolveCleanerCityRideCall');
    expect(callButton).toContain(ORDER_CALL_HONESTY);
    expect(migration).toContain('cleaner_city_ride');
    expect(migration).not.toContain('twilio');
    for (const src of [migration, orderPage, contactModal, callButton]) {
      expect(src).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
