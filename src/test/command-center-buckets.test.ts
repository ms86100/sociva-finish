import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  COMMAND_CENTER_BUCKETS,
  bucketTotal,
  istDayStart,
  rowInBucket,
  type CommandCenterFixtureRow,
} from '@/lib/commandCenterBuckets';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

const now = new Date('2026-09-26T02:00:00.000Z');

const fixture: CommandCenterFixtureRow[] = [
  { kind: 'seller', status: 'pending', societyId: 'soc-a' },
  { kind: 'seller', status: 'approved', societyId: 'soc-a' },
  { kind: 'product', status: 'pending', societyId: 'soc-a' },
  { kind: 'product', status: 'approved', societyId: 'soc-b' },
  { kind: 'order', status: 'placed', paymentStatus: 'paid', createdAt: '2026-09-25T19:00:00.000Z', societyId: 'soc-a' },
  { kind: 'order', status: 'placed', paymentStatus: 'awaiting_payment', createdAt: '2026-09-25T10:00:00.000Z', societyId: 'soc-a' },
  { kind: 'order', status: 'placed', paymentStatus: 'pending', createdAt: '2026-09-26T01:00:00.000Z', societyId: 'soc-b' },
  { kind: 'enquiry', status: 'enquired', sellerResponded: false, societyId: 'soc-a' },
  { kind: 'enquiry', status: 'enquired', sellerResponded: true, societyId: 'soc-a' },
  { kind: 'enquiry', status: 'quoted', sellerResponded: false, societyId: 'soc-a' },
  { kind: 'dispute', status: 'open', orderId: 'order-1', societyId: 'soc-a' },
  { kind: 'dispute', status: 'rejected', orderId: 'order-2', societyId: 'soc-a' },
  { kind: 'dispute', status: 'open', orderId: null, societyId: 'soc-a' },
  { kind: 'ticket', status: 'rejected', orderId: 'order-3', societyId: 'soc-a' },
  { kind: 'ticket', status: 'resolved', orderId: 'order-4', societyId: 'soc-a' },
];

describe('command center bucket predicates', () => {
  it('counts the India calendar day, not UTC midnight', () => {
    expect(istDayStart(now).toISOString()).toBe('2026-09-25T18:30:00.000Z');
    const istToday = fixture.filter((row) => rowInBucket('orders_today', row, now));
    const utcToday = fixture.filter((row) => {
      if (row.kind !== 'order' || !row.createdAt) return false;
      return new Date(row.createdAt).getTime() >= new Date('2026-09-26T00:00:00.000Z').getTime();
    });
    expect(istToday.map((row) => row.createdAt).sort()).toEqual([
      '2026-09-25T19:00:00.000Z',
      '2026-09-26T01:00:00.000Z',
    ]);
    expect(utcToday).toHaveLength(1);
  });

  it('uses one filter for the card count and the list', () => {
    for (const bucket of COMMAND_CENTER_BUCKETS) {
      const listed = fixture.filter((row) => rowInBucket(bucket.id, row, now));
      expect(bucketTotal(bucket.id, fixture, now)).toBe(listed.length);
    }
    expect(bucketTotal('pending_stores', fixture, now)).toBe(1);
    expect(bucketTotal('pending_products', fixture, now)).toBe(1);
    expect(bucketTotal('unanswered_enquiries', fixture, now)).toBe(1);
    expect(bucketTotal('open_disputes', fixture, now)).toBe(2);
    expect(bucketTotal('payment_waiting', fixture, now)).toBe(2);
    expect(bucketTotal('orders_today', fixture, now, 'soc-a')).toBe(1);
    expect(bucketTotal('orders_today', fixture, now, 'soc-b')).toBe(1);
  });

  it('shares the SQL predicate between the snapshot and each list', () => {
    const migration = read('supabase/migrations/20260926140451_command_center_shared_predicates.sql');
    const page = read('src/pages/AdminCommandCenterPage.tsx');
    expect(migration).toMatch(/admin_cc_order_is_today/);
    expect(migration).toMatch(/admin_cc_bucket_counts/);
    expect(migration).toMatch(/admin_cc_seller_is_pending/);
    expect(migration).toMatch(/admin_cc_product_is_pending/);
    expect(migration).toMatch(/admin_cc_enquiry_is_unanswered/);
    expect(migration).toMatch(/admin_cc_dispute_is_open/);
    expect(migration).toMatch(/admin_cc_dispute_ticket_is_open/);
    expect(migration).toMatch(/admin_cc_payment_is_waiting/);
    expect(migration).toMatch(/Asia\/Kolkata/);
    expect(migration).toContain("v_status = 'orders_today'");
    expect(page).not.toMatch(/startOfTodayIso/);
    expect(page).not.toMatch(/ListVsKpi/);
    expect(page).toMatch(/orders_today/);
    expect(page).toMatch(/None right now/);
    expect(page).toMatch(/12:00 AM IST/);
    expect(page).toMatch(/All societies/);
  });
});
