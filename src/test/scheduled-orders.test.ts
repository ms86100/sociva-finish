import { describe, expect, it } from 'vitest';
import {
  canBuyerCancelScheduled,
  daysUntilScheduledDate,
  getScheduledCountdownLabel,
  getScheduledFulfilmentAt,
  isScheduledOrder,
  isUpcomingScheduled,
  resolveScheduledPhase,
  toScheduledDateParam,
} from '@/lib/scheduled-orders';

describe('scheduled-orders', () => {
  const aug25Order = {
    status: 'scheduled',
    scheduled_date: '2026-08-25',
    scheduled_time_start: '10:00:00',
    created_at: '2026-08-22T14:00:00+05:30',
  };

  it('detects scheduled orders', () => {
    expect(isScheduledOrder(aug25Order)).toBe(true);
    expect(isScheduledOrder({ status: 'placed' })).toBe(false);
  });

  it('parses fulfilment instant in IST', () => {
    const at = getScheduledFulfilmentAt(aug25Order);
    expect(at).not.toBeNull();
    expect(at!.toISOString()).toContain('2026-08-25');
  });

  it('treats Aug 25 order as upcoming on Aug 22', () => {
    const now = new Date('2026-08-22T12:00:00+05:30');
    expect(daysUntilScheduledDate('2026-08-25', now)).toBe(3);
    expect(isUpcomingScheduled(aug25Order, now)).toBe(true);
    expect(resolveScheduledPhase(aug25Order, now)).toBe('upcoming');
    expect(getScheduledCountdownLabel(aug25Order, now)).toBe('3 days to go');
  });

  it('shows tomorrow label one day before', () => {
    const now = new Date('2026-08-24T12:00:00+05:30');
    expect(getScheduledCountdownLabel(aug25Order, now)).toBe('Tomorrow');
  });

  it('blocks buyer cancel after cancellation cutoff', () => {
    const order = {
      status: 'scheduled',
      scheduled_date: '2026-08-25',
      scheduled_time_start: '10:00:00',
      cancellation_cutoff_at: '2026-08-24T12:00:00+05:30',
      created_at: '2026-08-22T10:00:00+05:30',
    };
    const afterCutoff = new Date('2026-08-24T13:00:00+05:30');
    expect(canBuyerCancelScheduled(order, afterCutoff)).toBe(false);
    const beforeCutoff = new Date('2026-08-24T11:00:00+05:30');
    expect(canBuyerCancelScheduled(order, beforeCutoff)).toBe(true);
  });

  it('allows cancel when cutoff was already expired at creation (same-day late book)', () => {
    const order = {
      status: 'placed',
      scheduled_date: '2026-08-23',
      scheduled_time_start: '13:30:00',
      cancellation_cutoff_at: '2026-08-22T13:30:00+05:30',
      preparation_start_at: '2026-08-23T12:30:00+05:30',
      created_at: '2026-08-23T10:35:00+05:30',
    };
    const justAfterPlace = new Date('2026-08-23T10:40:00+05:30');
    expect(canBuyerCancelScheduled(order, justAfterPlace)).toBe(true);
  });

  it('moves to preparing phase when status is preparing', () => {
    const now = new Date('2026-08-25T09:30:00+05:30');
    expect(resolveScheduledPhase({ ...aug25Order, status: 'preparing' }, now)).toBe('preparing');
    expect(getScheduledCountdownLabel({ ...aug25Order, status: 'preparing' }, now)).toBe(
      'Preparing your order',
    );
  });

  it('toScheduledDateParam keeps the picker calendar day', () => {
    // new Date(y, m, d) is local midnight of that civil day — must not use toISOString().
    const localMidnight = new Date(2026, 7, 23, 0, 0, 0, 0);
    expect(toScheduledDateParam(localMidnight)).toBe('2026-08-23');
  });
});
