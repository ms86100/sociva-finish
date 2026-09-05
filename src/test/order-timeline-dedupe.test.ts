import { describe, expect, it } from 'vitest';
import { dedupeTimelineEvents, getTimelineLabel } from '@/components/order/OrderTimeline';

describe('OrderTimeline labels + dedupe', () => {
  it('maps order_status_* audit actions to friendly labels', () => {
    expect(getTimelineLabel('order_status_preparing', { to_status: 'preparing' })).toBe('Preparing');
    expect(getTimelineLabel('order_status_delivered', { to_status: 'delivered' })).toBe('Delivered');
    expect(getTimelineLabel('order_status_changed', { new_status: 'on_the_way' })).toBe('On the way');
  });

  it('does not show raw "order status preparing" duplicates', () => {
    const events = [
      {
        id: '1',
        action: 'order_status_placed',
        actor_id: null,
        metadata: { to_status: 'placed' },
        created_at: '2026-09-04T06:21:30.000Z',
      },
      {
        id: '2',
        action: 'order_status_changed',
        actor_id: null,
        metadata: { new_status: 'preparing', old_status: 'scheduled' },
        created_at: '2026-09-04T06:27:58.000Z',
      },
      {
        id: '3',
        action: 'order_status_preparing',
        actor_id: null,
        metadata: { to_status: 'preparing', from_status: 'scheduled' },
        created_at: '2026-09-04T06:27:58.000Z',
      },
      {
        id: '4',
        action: 'order_status_changed',
        actor_id: null,
        metadata: { new_status: 'delivered', old_status: 'on_the_way' },
        created_at: '2026-09-04T06:30:44.000Z',
      },
      {
        id: '5',
        action: 'order_status_delivered',
        actor_id: null,
        metadata: { to_status: 'delivered' },
        created_at: '2026-09-04T06:30:44.000Z',
      },
    ];

    const cleaned = dedupeTimelineEvents(events);
    expect(cleaned.map((e) => e.id)).toEqual(['1', '2', '4']);
    expect(cleaned.map((e) => getTimelineLabel(e.action, e.metadata))).toEqual([
      'Order placed',
      'Preparing',
      'Delivered',
    ]);
  });
});
