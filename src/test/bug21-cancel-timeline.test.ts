import { describe, expect, it } from 'vitest';
import { formatOrderCancellationHeroReason } from '@/lib/order-cancellation-copy';
import { buildScheduledTimeline, hasSellerAccepted } from '@/lib/scheduled-orders';

describe('BUG-21 cancellation copy', () => {
  it('buyer cancel — buyer view', () => {
    expect(
      formatOrderCancellationHeroReason(
        { failure_owner: 'buyer', rejection_reason: 'Cancelled by buyer: Changed my mind' },
        'buyer',
      ),
    ).toBe('You cancelled this order — Changed my mind');
  });

  it('buyer cancel — seller view', () => {
    expect(
      formatOrderCancellationHeroReason(
        { failure_owner: 'buyer', rejection_reason: 'Cancelled by buyer: Changed my mind' },
        'seller',
      ),
    ).toBe('Cancelled by buyer — Changed my mind');
  });

  it('seller reject — seller view uses Rejected not Cancelled', () => {
    expect(
      formatOrderCancellationHeroReason(
        { failure_owner: 'seller', rejection_reason: 'Kitchen closed / Not available now' },
        'seller',
      ),
    ).toBe('You rejected this order — Kitchen closed / Not available now');
  });

  it('seller reject — buyer view', () => {
    expect(
      formatOrderCancellationHeroReason(
        { failure_owner: 'seller', rejection_reason: 'Rejected by seller: Kitchen closed' },
        'buyer',
      ),
    ).toBe('Rejected by seller — Kitchen closed');
  });
});

describe('BUG-21 scheduled timeline accepted step', () => {
  const base = {
    scheduled_date: '2026-09-05',
    scheduled_time_start: '12:00:00',
    created_at: '2026-09-04T09:00:00+00:00',
    updated_at: '2026-09-04T09:05:00+00:00',
  };

  it('cancelled from placed without accepted_at → Seller accepted not done', () => {
    expect(hasSellerAccepted({ ...base, status: 'cancelled' })).toBe(false);
    const steps = buildScheduledTimeline({ ...base, status: 'cancelled' });
    const confirmed = steps.find((s) => s.id === 'confirmed')!;
    expect(confirmed.state).toBe('upcoming');
    expect(confirmed.at).toBeUndefined();
  });

  it('scheduled status → Seller accepted done', () => {
    const steps = buildScheduledTimeline({ ...base, status: 'scheduled', accepted_at: '2026-09-04T09:02:00+00:00' });
    const confirmed = steps.find((s) => s.id === 'confirmed')!;
    expect(confirmed.state).toBe('done');
    expect(confirmed.at).toBe('2026-09-04T09:02:00+00:00');
  });

  it('cancelled after accept keeps Seller accepted done via accepted_at', () => {
    const steps = buildScheduledTimeline({
      ...base,
      status: 'cancelled',
      accepted_at: '2026-09-04T09:02:00+00:00',
      updated_at: '2026-09-04T09:10:00+00:00',
    });
    const confirmed = steps.find((s) => s.id === 'confirmed')!;
    expect(confirmed.state).toBe('done');
    expect(confirmed.at).toBe('2026-09-04T09:02:00+00:00');
  });
});
