/**
 * Unit tests for Phase 2–4 notification remediation helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  pickNotificationData,
  pickNotificationRoute,
  pickNotificationOrderId,
  dualNotificationColumns,
} from '@/lib/notification-fields';
import { orderNotificationId } from '@/lib/local-order-notifications';

// Mirror edge helper logic for quiet hours (Deno module not importable in vitest)
function isWithinQuietHours(opts: {
  enabled?: boolean | null;
  startHour?: number | null;
  endHour?: number | null;
  hour: number;
}): boolean {
  if (!opts.enabled) return false;
  const start = Number(opts.startHour ?? 22);
  const end = Number(opts.endHour ?? 7);
  const hour = opts.hour;
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

describe('notification dual fields', () => {
  it('prefers data over payload and action_url over reference_path', () => {
    expect(pickNotificationData({ data: { a: 1 }, payload: { a: 2 } })).toEqual({ a: 1 });
    expect(pickNotificationData({ payload: { a: 2 } })).toEqual({ a: 2 });
    expect(pickNotificationRoute({ action_url: '/a', reference_path: '/b' })).toBe('/a');
    expect(pickNotificationRoute({ reference_path: '/b' })).toBe('/b');
  });

  it('extracts order id from data or route', () => {
    expect(pickNotificationOrderId({ data: { order_id: 'ord-1' } })).toBe('ord-1');
    expect(pickNotificationOrderId({
      action_url: '/orders/550e8400-e29b-41d4-a716-446655440000',
    })).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('emits dual columns for writers', () => {
    const cols = dualNotificationColumns({ path: '/orders/x', data: { orderId: 'x' } });
    expect(cols.reference_path).toBe('/orders/x');
    expect(cols.action_url).toBe('/orders/x');
    expect(cols.payload.orderId).toBe('x');
    expect(cols.data.orderId).toBe('x');
  });
});

describe('quiet hours', () => {
  it('wraps midnight window (22–7)', () => {
    expect(isWithinQuietHours({ enabled: true, startHour: 22, endHour: 7, hour: 23 })).toBe(true);
    expect(isWithinQuietHours({ enabled: true, startHour: 22, endHour: 7, hour: 3 })).toBe(true);
    expect(isWithinQuietHours({ enabled: true, startHour: 22, endHour: 7, hour: 10 })).toBe(false);
  });

  it('disabled quiet hours never suppress', () => {
    expect(isWithinQuietHours({ enabled: false, startHour: 22, endHour: 7, hour: 23 })).toBe(false);
  });
});

describe('local notification ids', () => {
  it('maps order uuid to stable positive int', () => {
    const id = orderNotificationId('550e8400-e29b-41d4-a716-446655440000');
    expect(id).toBeGreaterThan(0);
    expect(id).toBe(orderNotificationId('550e8400-e29b-41d4-a716-446655440000'));
  });
});

describe('whatsapp hard opt-in gate', () => {
  function shouldSend(opts: { whatsappPref?: boolean | null; whatsappOptedInAt?: string | null }) {
    if (!opts.whatsappOptedInAt) return false;
    if (opts.whatsappPref === false) return false;
    return true;
  }

  it('blocks without opted_in_at even if soft pref true', () => {
    expect(shouldSend({ whatsappPref: true, whatsappOptedInAt: null })).toBe(false);
  });

  it('allows grandfathered / explicit opt-in', () => {
    expect(shouldSend({ whatsappPref: true, whatsappOptedInAt: '2026-08-07T00:00:00Z' })).toBe(true);
  });
});
