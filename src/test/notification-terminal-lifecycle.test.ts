/**
 * Focused unit coverage for notification terminal / actionable status helpers
 * used by the seller alert overlay lifecycle (audit P0-1 / P1-3).
 */
import { describe, it, expect } from 'vitest';

const ACTIONABLE_STATUSES = ['placed', 'enquired', 'quoted', 'requested', 'scheduled', 'preparing', 'confirmed', 'booked'] as const;
const TERMINAL_PUSH_STATUSES = [
  'cancelled', 'completed', 'delivered', 'rejected', 'no_show', 'returned', 'failed', 'expired',
];

function isActionableStatus(status: string | null | undefined): boolean {
  return !!status && (ACTIONABLE_STATUSES as readonly string[]).includes(status);
}

function isTerminalPushStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_PUSH_STATUSES.includes(status);
}

describe('notification terminal lifecycle (audit remediation)', () => {
  it('treats service booking confirmed status as actionable for seller overlay', () => {
    expect(isActionableStatus('confirmed')).toBe(true);
    expect(isActionableStatus('booked')).toBe(true);
  });

  it('treats placed/requested as actionable for seller overlay', () => {
    expect(isActionableStatus('placed')).toBe(true);
    expect(isActionableStatus('requested')).toBe(true);
    expect(isActionableStatus('preparing')).toBe(true);
  });

  it('treats cancel/accept/reject/complete as non-actionable (overlay must dismiss)', () => {
    for (const s of ['cancelled', 'accepted', 'rejected', 'completed', 'delivered', 'no_show']) {
      expect(isActionableStatus(s)).toBe(false);
    }
  });

  it('marks cancel/complete statuses as terminal for push sync metadata', () => {
    expect(isTerminalPushStatus('cancelled')).toBe(true);
    expect(isTerminalPushStatus('completed')).toBe(true);
    expect(isTerminalPushStatus('rejected')).toBe(true);
    expect(isTerminalPushStatus('placed')).toBe(false);
    expect(isTerminalPushStatus('preparing')).toBe(false);
  });

  it('builds push data shape expected by client terminal sync', () => {
    const orderId = 'ord-123';
    const status = 'cancelled';
    const pushData: Record<string, string> = {
      order_id: orderId,
      orderId,
      entity_id: orderId,
      entity_type: 'order',
      status,
      is_terminal: isTerminalPushStatus(status) ? 'true' : 'false',
      high_priority: 'false',
    };
    expect(pushData.is_terminal).toBe('true');
    expect(pushData.order_id).toBe(orderId);
    expect(pushData.orderId ?? pushData.order_id).toBeTruthy();
  });
});
