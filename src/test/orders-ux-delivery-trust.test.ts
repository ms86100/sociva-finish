import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveOrderListPriority,
  sortOrdersByListPriority,
} from '@/lib/order-list-priority';
import {
  matchesSellerReceivedFilter,
  isTransitOverdue,
  formatTransitAgeChip,
  TRANSIT_OVERDUE_MS,
} from '@/lib/order-due-windows';
import {
  rememberDismissedReviewOrderId,
  isReviewOrderLocallyDismissed,
  readDismissedReviewOrderIds,
} from '@/lib/review-prompt-dismiss';
import { getBuyerRefundEligibility, STUCK_TRANSIT_REFUND_AFTER_HOURS } from '@/lib/buyer-refund-eligibility';
import { getProximityMessage } from '@/components/delivery/LiveDeliveryTracker';

describe('order-list-priority', () => {
  const success = new Set(['delivered', 'completed']);
  const terminal = new Set(['delivered', 'completed', 'cancelled', 'rejected', 'no_show']);

  it('buckets active before completed before cancelled', () => {
    expect(resolveOrderListPriority('on_the_way', success, terminal)).toBe('active');
    expect(resolveOrderListPriority('delivered', success, terminal)).toBe('completed');
    expect(resolveOrderListPriority('cancelled', success, terminal)).toBe('cancelled');
  });

  it('sorts mixed list with cancelled last', () => {
    const sorted = sortOrdersByListPriority(
      [
        { status: 'cancelled', created_at: '2026-09-20T12:00:00Z' },
        { status: 'on_the_way', created_at: '2026-09-19T12:00:00Z' },
        { status: 'delivered', created_at: '2026-09-20T10:00:00Z' },
      ],
      success,
      terminal,
    );
    expect(sorted.map((o) => o.status)).toEqual(['on_the_way', 'delivered', 'cancelled']);
  });
});

describe('order-due-windows', () => {
  it('detects overdue transit by status_changed_at age', () => {
    const old = new Date(Date.now() - TRANSIT_OVERDUE_MS - 60_000).toISOString();
    expect(isTransitOverdue({ status: 'on_the_way', status_changed_at: old })).toBe(true);
    expect(matchesSellerReceivedFilter({ status: 'on_the_way', status_changed_at: old }, 'overdue')).toBe(true);
  });

  it('formats transit age chip', () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const chip = formatTransitAgeChip({ status: 'on_the_way', status_changed_at: old });
    expect(chip?.tone).toBe('warn');
    expect(chip?.label.toLowerCase()).toContain('overdue');
  });
});

describe('review-prompt-dismiss local storage', () => {
  const KEY = 'sociva:dismissed-review-prompts';
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('remembers dismissed order ids across reads', () => {
    rememberDismissedReviewOrderId('abc-123');
    expect(isReviewOrderLocallyDismissed('abc-123')).toBe(true);
    expect(readDismissedReviewOrderIds().has('abc-123')).toBe(true);
  });
});

describe('buyer refund stuck transit escape hatch', () => {
  it('allows refund request for paid on_the_way after SLA hours', () => {
    const changed = new Date(
      Date.now() - (STUCK_TRANSIT_REFUND_AFTER_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();
    const result = getBuyerRefundEligibility({
      orderStatus: 'on_the_way',
      paymentStatus: 'paid',
      statusChangedAt: changed,
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ok_stuck_transit');
  });

  it('still blocks recent unpaid transit', () => {
    const result = getBuyerRefundEligibility({
      orderStatus: 'on_the_way',
      paymentStatus: 'pending',
      statusChangedAt: new Date().toISOString(),
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_payment');
  });
});

describe('LiveDeliveryTracker proximity honesty', () => {
  const config = {
    at_doorstep: { max_meters: 50, buyer_message: 'door', seller_message: 'door' },
    arriving: { max_meters: 200, buyer_message: 'arriving', seller_message: 'arriving' },
    nearby: { max_meters: 500, buyer_message: 'nearby', seller_message: 'nearby' },
    eta_2min: { buyer_message: 'Arriving in about 2 minutes', seller_message: '2m' },
    eta_5min: { buyer_prefix: 'Arriving in about', seller_prefix: 'Around', suffix: 'minutes' },
    default: { buyer_message: 'On the way', seller_message: 'In progress' },
  };

  it('does not claim arriving in 2 minutes when location is stale', () => {
    const msg = getProximityMessage(100, 2, null, true, config as any, true, 2);
    expect(msg.toLowerCase()).toContain('tracking paused');
    expect(msg).not.toContain('2 minutes');
  });
});

describe('OrderHelpSheet pre-delivery statuses', () => {
  it('includes real transit statuses not only out_for_delivery', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const file = fs.readFileSync(
      path.resolve(__dirname, '../components/order/OrderHelpSheet.tsx'),
      'utf8',
    );
    expect(file).toContain("'on_the_way'");
    expect(file).toContain("'picked_up'");
    expect(file).toContain("'at_gate'");
  });
});

describe('seller overdue outcome bar gating', () => {
  it('does not treat scheduled past-due as in-transit for OTP outcome bar', async () => {
    const { isInTransitStatus, isTransitOverdue } = await import('@/lib/order-due-windows');
    const scheduledPastDue = {
      status: 'scheduled',
      preparation_start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    expect(isTransitOverdue(scheduledPastDue)).toBe(true);
    expect(isInTransitStatus(scheduledPastDue.status)).toBe(false);
  });
});
