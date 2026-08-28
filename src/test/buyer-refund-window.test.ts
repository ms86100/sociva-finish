import { describe, expect, it } from 'vitest';
import {
  BUYER_REFUND_WINDOW_HOURS,
  buyerRefundWindowClosedMessage,
  getBuyerRefundEligibility,
} from '@/lib/buyer-refund-eligibility';

describe('buyer refund eligibility', () => {
  const deliveredAt = '2026-08-28T10:00:00.000Z';

  it('allows refund within the delivery window', () => {
    const result = getBuyerRefundEligibility({
      orderStatus: 'delivered',
      paymentStatus: 'paid',
      deliveredAt,
      now: new Date('2026-08-28T11:30:00.000Z'),
    });
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.windowHours).toBe(BUYER_REFUND_WINDOW_HOURS);
  });

  it('blocks refund after the 2-hour window', () => {
    const result = getBuyerRefundEligibility({
      orderStatus: 'delivered',
      paymentStatus: 'paid',
      deliveredAt,
      now: new Date('2026-08-28T12:01:00.000Z'),
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('window_closed');
  });

  it('blocks refund before delivery', () => {
    const result = getBuyerRefundEligibility({
      orderStatus: 'on_the_way',
      paymentStatus: 'paid',
      deliveredAt: null,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_delivered');
  });

  it('blocks refund for unpaid orders', () => {
    const result = getBuyerRefundEligibility({
      orderStatus: 'delivered',
      paymentStatus: 'pending',
      deliveredAt,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('no_payment');
  });

  it('does not allow cancelled status without delivery window', () => {
    const result = getBuyerRefundEligibility({
      orderStatus: 'cancelled',
      paymentStatus: 'paid',
      deliveredAt,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_delivered');
  });

  it('falls back to completed_at when delivered_at is missing', () => {
    const result = getBuyerRefundEligibility({
      orderStatus: 'completed',
      paymentStatus: 'paid',
      completedAt: deliveredAt,
      now: new Date('2026-08-28T10:30:00.000Z'),
    });
    expect(result.eligible).toBe(true);
  });

  it('explains when the window is closed', () => {
    expect(buyerRefundWindowClosedMessage()).toMatch(/2 hours/);
  });
});

describe('refund request card policy', () => {
  it('uses buyer refund eligibility helper', async () => {
    const fs = await import('node:fs/promises');
    const path = 'src/components/refund/RefundRequestCard.tsx';
    const content = await fs.readFile(path, 'utf8');
    expect(content).toContain('getBuyerRefundEligibility');
    expect(content).toContain('deliveredAt');
    expect(content).not.toContain("'cancelled'");
  });
});

describe('payment verify reminder migration', () => {
  it('defines cron and high-priority seller reminder payload', async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile(
      'supabase/migrations/20260828220000_buyer_refund_window_and_payment_reminder.sql',
      'utf8',
    );
    expect(sql).toContain('enqueue_seller_payment_verify_reminders');
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain('reminder_type');
    expect(sql).toContain('sociva_payment_update');
    expect(sql).toContain("interval '2 hours'");
  });

  it('treats payment_verify and refund_request as high priority in PNQ', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile('supabase/functions/process-notification-queue/index.ts', 'utf8');
    expect(content).toContain('payment_verify_pending');
    expect(content).toContain("rawPayload.reminder_type === 'payment_verify'");
    expect(content).toContain("item.type === 'refund_request'");
    expect(content).toContain('refund_requested');
  });
});
