import { describe, it, expect } from 'vitest';
import {
  shouldKeepIncomingOrderAlert,
  isInsertAlertStatus,
} from '@/lib/order-alert-ack';

describe('order-alert-ack', () => {
  it('keeps looping bell only for first-response statuses', () => {
    expect(shouldKeepIncomingOrderAlert('placed')).toBe(true);
    expect(shouldKeepIncomingOrderAlert('enquired')).toBe(true);
    expect(shouldKeepIncomingOrderAlert('quoted')).toBe(true);
    expect(shouldKeepIncomingOrderAlert('requested')).toBe(true);
  });

  it('stops looping bell after accept / prepare / schedule confirm', () => {
    for (const s of ['accepted', 'preparing', 'scheduled', 'confirmed', 'cancelled', 'rejected', 'delivered']) {
      expect(shouldKeepIncomingOrderAlert(s)).toBe(false);
    }
  });

  it('still allows one-shot insert alerts for auto-accept / booking', () => {
    expect(isInsertAlertStatus('preparing')).toBe(true);
    expect(isInsertAlertStatus('scheduled')).toBe(true);
    expect(isInsertAlertStatus('confirmed')).toBe(true);
    expect(isInsertAlertStatus('accepted')).toBe(false);
  });
});
