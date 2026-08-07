import { describe, it, expect } from 'vitest';
import {
  STATUS_TO_BUCKET,
  resolveBoardBucket,
  isSettledRevenueOrder,
  aggregateSellerBoardFromOrders,
  statusesForFilter,
  sellerDisplayStatusLabel,
  computeFulfillMinutes,
  resolveFulfillEndAt,
  sumDashboardKpis,
  sumBoardCounts,
  emptyDashboardKpis,
  emptyBoardCounts,
  isPortfolioSellerId,
  ALL_STORES_ID,
  resolveOperationalSellerId,
} from '@/lib/seller-order-board';

const ENUM_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'picked_up',
  'delivered',
  'payment_pending',
  'awaiting_cod_confirmation',
  'on_the_way',
  'arrived',
  'assigned',
  'enquired',
  'quoted',
  'scheduled',
  'in_progress',
  'returned',
  'confirmed',
  'no_show',
  'requested',
  'rescheduled',
  'at_gate',
  'failed',
  'buyer_received',
  'pending',
  'rejected',
  'en_route',
] as const;

describe('seller-order-board taxonomy', () => {
  it('maps every order_status enum value to a documented bucket', () => {
    for (const status of ENUM_STATUSES) {
      expect(STATUS_TO_BUCKET[status], `missing map for ${status}`).toBeDefined();
    }
  });

  it('never counts preparing/ready as action needed', () => {
    expect(resolveBoardBucket('preparing')).toBe('preparing');
    expect(resolveBoardBucket('ready')).toBe('ready');
    expect(resolveBoardBucket('placed')).toBe('action_needed');
    expect(resolveBoardBucket('accepted')).toBe('action_needed');
  });

  it('hides unpaid payment_pending unless buyer_confirmed', () => {
    expect(resolveBoardBucket('payment_pending', 'pending')).toBe('hidden');
    expect(resolveBoardBucket('payment_pending', 'buyer_confirmed')).toBe('action_needed');
  });

  it('settled GMV excludes refunded and open statuses', () => {
    expect(isSettledRevenueOrder('completed', 'paid')).toBe(true);
    expect(isSettledRevenueOrder('delivered', null)).toBe(true);
    expect(isSettledRevenueOrder('completed', 'refunded')).toBe(false);
    expect(isSettledRevenueOrder('preparing', 'paid')).toBe(false);
    expect(isSettledRevenueOrder('cancelled', 'paid')).toBe(false);
  });

  it('aggregates KPI pending without preparing/ready inflation', () => {
    const { kpis, counts } = aggregateSellerBoardFromOrders(
      [
        { status: 'placed', payment_status: 'paid', total_amount: 100, created_at: '2099-01-01T00:00:00Z' },
        { status: 'preparing', payment_status: 'paid', total_amount: 200, created_at: '2099-01-01T00:00:00Z' },
        { status: 'ready', payment_status: 'paid', total_amount: 300, created_at: '2099-01-01T00:00:00Z' },
        { status: 'completed', payment_status: 'paid', total_amount: 400, created_at: '2099-01-01T00:00:00Z' },
        { status: 'completed', payment_status: 'refunded', total_amount: 500, created_at: '2099-01-01T00:00:00Z' },
        { status: 'payment_pending', payment_status: 'pending', total_amount: 50, created_at: '2099-01-01T00:00:00Z' },
      ],
      { now: new Date('2099-01-01T12:00:00+05:30') },
    );

    expect(kpis.pendingOrders).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.preparing).toBe(1);
    expect(counts.ready).toBe(1);
    expect(kpis.totalEarnings).toBe(400);
    expect(counts.all).toBe(5); // hidden phantom excluded
  });

  it('filter status lists match board buckets', () => {
    expect(statusesForFilter('pending')).toContain('placed');
    expect(statusesForFilter('pending')).not.toContain('preparing');
    expect(statusesForFilter('pending')).not.toContain('ready');
    expect(statusesForFilter('in_transit')).toEqual(
      expect.arrayContaining(['picked_up', 'on_the_way', 'at_gate', 'en_route']),
    );
    expect(statusesForFilter('cancelled')).toEqual(expect.arrayContaining(['cancelled', 'rejected']));
  });

  it('shows Cancelled (Rejected) when rejection_reason present', () => {
    expect(sellerDisplayStatusLabel('cancelled', 'Out of stock')).toBe('Cancelled (Rejected)');
    expect(sellerDisplayStatusLabel('rejected', null)).toBe('Cancelled (Rejected)');
    expect(sellerDisplayStatusLabel('cancelled', null)).toBeNull();
  });

  it('prefers delivered_at over updated_at for fulfill minutes', () => {
    expect(
      resolveFulfillEndAt({
        delivered_at: '2099-01-01T01:00:00Z',
        status_changed_at: '2099-01-01T00:45:00Z',
        updated_at: '2099-01-02T00:00:00Z',
      }),
    ).toBe('2099-01-01T01:00:00Z');

    expect(computeFulfillMinutes('2099-01-01T00:00:00Z', '2099-01-01T00:30:00Z')).toBe(30);
    expect(computeFulfillMinutes('2099-01-01T00:00:00Z', null)).toBeNull();

    const { kpis } = aggregateSellerBoardFromOrders(
      [
        {
          status: 'completed',
          payment_status: 'paid',
          total_amount: 100,
          created_at: '2099-01-01T00:00:00Z',
          delivered_at: '2099-01-01T00:40:00Z',
          updated_at: '2099-01-03T00:00:00Z',
        },
      ],
      { now: new Date('2099-01-01T12:00:00+05:30') },
    );
    expect(kpis.avgFulfillMinutes).toBe(40);
  });

  it('portfolio helpers sum KPIs and counts without silent blending', () => {
    expect(isPortfolioSellerId(ALL_STORES_ID)).toBe(true);
    expect(isPortfolioSellerId('uuid')).toBe(false);
    expect(resolveOperationalSellerId(ALL_STORES_ID, [{ id: 'a' }, { id: 'b' }])).toBeNull();
    expect(resolveOperationalSellerId('a', [{ id: 'a' }, { id: 'b' }])).toBe('a');

    const a = {
      ...emptyDashboardKpis(),
      pendingOrders: 2,
      totalEarnings: 100,
      todayEarnings: 40,
      completedOrders: 3,
      avgFulfillMinutes: 20,
      cancelRate30d: 10,
      totalOrders: 10,
    };
    const b = {
      ...emptyDashboardKpis(),
      pendingOrders: 1,
      totalEarnings: 50,
      todayEarnings: 10,
      completedOrders: 1,
      avgFulfillMinutes: 40,
      cancelRate30d: 0,
      totalOrders: 5,
    };
    const summed = sumDashboardKpis([a, b]);
    expect(summed.pendingOrders).toBe(3);
    expect(summed.totalEarnings).toBe(150);
    expect(summed.todayEarnings).toBe(50);
    expect(summed.avgFulfillMinutes).toBe(25); // (20*3 + 40*1) / 4

    const counts = sumBoardCounts([
      { ...emptyBoardCounts(), pending: 2, all: 5 },
      { ...emptyBoardCounts(), pending: 1, all: 3 },
    ]);
    expect(counts.pending).toBe(3);
    expect(counts.all).toBe(8);
  });
});
