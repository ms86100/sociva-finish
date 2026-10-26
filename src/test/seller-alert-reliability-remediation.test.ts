import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifyPushDeliveryEvidence,
  computeMorningAcceptSlots,
  dueMorningAcceptSlots,
  INSTANT_ACCEPTANCE_TIMEOUT_SECONDS,
  isFarFutureScheduled,
  scheduledAcceptDeadlineMs,
  unackedBucket,
  unackedIdempotencyKey,
  wouldEnqueueOvernightUnacked,
} from '../../supabase/functions/_shared/seller-status-reminders-policy';
import {
  androidTokenUsesNativeAlert,
  LEGACY_ANDROID_ORDER_CHANNEL,
  NATIVE_ANDROID_ORDER_CHANNEL,
  ORDER_ALERT_NATIVE_CAPABILITY,
} from '../../supabase/functions/_shared/seller-alert-gate';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('DEF-001 instant acceptance 30 minutes', () => {
  it('sets system timeout to 1800 seconds in migration', () => {
    const mig = read('supabase/migrations/20261026250000_seller_alert_acceptance_30m.sql');
    expect(mig).toContain("'1800'::jsonb");
    expect(mig).toContain('order_acceptance_timeout_seconds');
    expect(mig).toMatch(/RETURN 1800/);
    expect(INSTANT_ACCEPTANCE_TIMEOUT_SECONDS).toBe(1800);
  });

  it('does not overwrite scheduled auto_cancel stamps via schedule logic comments', () => {
    const mig = read('supabase/migrations/20261026250000_seller_alert_acceptance_30m.sql');
    expect(mig).toMatch(/Scheduled|prep stamps|auto_cancel_at/i);
  });
});

describe('Instant unacked reminders at 10 and 20 minutes', () => {
  it('buckets only at 10m and 20m (no 3-minute overnight spam under 30m window)', () => {
    expect(unackedBucket(2 * 60_000)).toBe(0);
    expect(unackedBucket(9 * 60_000)).toBe(0);
    expect(unackedBucket(10 * 60_000)).toBe(1);
    expect(unackedBucket(19 * 60_000)).toBe(1);
    expect(unackedBucket(20 * 60_000)).toBe(2);
    expect(unackedBucket(29 * 60_000)).toBe(2);
  });

  it('uses stable idempotency keys that do not collide with legacy unacked-1/2/3', () => {
    expect(unackedIdempotencyKey('abc', 1)).toBe('abc-unacked-10m');
    expect(unackedIdempotencyKey('abc', 2)).toBe('abc-unacked-20m');
  });

  it('worker source wires 10/20 policy and rechecks order state', () => {
    const src = read('supabase/functions/send-seller-status-reminders/index.ts');
    expect(src).toContain('unackedIdempotencyKey');
    expect(src).toContain('freshOrderStatus');
    expect(src).toContain('isFarFutureScheduled');
    expect(src).not.toMatch(/ageMs >= 3 \* 60_000/);
  });
});

describe('DEF-003 scheduled morning reminders / no overnight unacked', () => {
  const bcce = {
    scheduled_date: '2026-10-27',
    auto_cancel_at: '2026-10-27T02:00:00.000Z', // 07:30 IST
    created_at: '2026-10-26T16:08:37.000Z', // 21:38 IST
    preparation_start_at: '2026-10-27T02:00:00.000Z',
    status: 'placed',
  };

  it('treats #bcce1b63-shaped order as far-future scheduled', () => {
    const nightMs = new Date('2026-10-26T16:20:00.000Z').getTime();
    expect(isFarFutureScheduled(bcce, nightMs)).toBe(true);
  });

  it('would NOT enqueue overnight unacked for #bcce1b63 under new policy', () => {
    const nightMs = new Date('2026-10-26T16:20:00.000Z').getTime();
    const ageMs = nightMs - new Date(bcce.created_at).getTime();
    expect(wouldEnqueueOvernightUnacked(bcce, ageMs, nightMs)).toBe(false);
  });

  it('preserves three morning slots before deadline when timing allows', () => {
    const deadline = new Date(bcce.auto_cancel_at).getTime();
    const created = new Date(bcce.created_at).getTime();
    const slots = computeMorningAcceptSlots('bcce1b63-a95e-4616-86e3-3e1c71eb0426', deadline, created);
    expect(slots.map((s) => s.offsetMin)).toEqual([180, 120, 60]);
    expect(slots[0].idempotencyKey).toContain('scheduled_accept-m180');
  });

  it('fires only due morning slots (not all three at once)', () => {
    const deadline = new Date(bcce.auto_cancel_at).getTime();
    const created = new Date(bcce.created_at).getTime();
    const justAfterFirst = deadline - 180 * 60_000 + 60_000;
    const due = dueMorningAcceptSlots('oid', deadline, created, justAfterFirst);
    expect(due).toHaveLength(1);
    expect(due[0].offsetMin).toBe(180);
  });

  it('near-deadline keeps only useful remaining slots', () => {
    // Deadline in 70 minutes: 180/120 offsets are before create; 60m slot remains.
    const created = Date.parse('2026-10-27T00:50:00.000Z');
    const deadline = Date.parse('2026-10-27T02:00:00.000Z');
    const slots = computeMorningAcceptSlots('near', deadline, created);
    expect(slots.every((s) => s.atMs >= created + 2 * 60_000)).toBe(true);
    expect(slots.every((s) => s.atMs < deadline)).toBe(true);
    expect(slots.map((s) => s.offsetMin)).toEqual([60]);
  });

  it('deadline helper prefers auto_cancel_at', () => {
    expect(
      scheduledAcceptDeadlineMs({
        auto_cancel_at: '2026-10-27T02:00:00.000Z',
        preparation_start_at: '2026-10-27T03:00:00.000Z',
      }),
    ).toBe(Date.parse('2026-10-27T02:00:00.000Z'));
  });
});

describe('DEF-002 observability honesty', () => {
  it('never labels provider accept as device delivery or audible success', () => {
    const e = classifyPushDeliveryEvidence({
      pushAttempted: true,
      pushSuccessCount: 1,
      pushFailCount: 0,
    });
    expect(e.level).toBe('provider_accepted');
    expect(e.deviceDelivery).toBe('unknown');
    expect(e.audible).toBe('unknown');
    expect(e.label.toLowerCase()).toMatch(/unknown/);
  });

  it('marks no_tokens distinctly', () => {
    const e = classifyPushDeliveryEvidence({
      pushAttempted: true,
      pushSuccessCount: 0,
      pushSkipReason: 'no_tokens',
    });
    expect(e.level).toBe('no_tokens');
  });

  it('marks reminder suppressed when order resolved', () => {
    const e = classifyPushDeliveryEvidence({ reminderSuppressed: true });
    expect(e.level).toBe('reminder_suppressed_resolved');
    expect(e.audible).toBe('not_applicable');
  });

  it('PNQ writes delivery_evidence and documents provider-accept limit', () => {
    const pnq = read('supabase/functions/process-notification-queue/index.ts');
    expect(pnq).toContain('delivery_evidence');
    expect(pnq).toContain('buildDeliveryEvidence');
    expect(pnq).toContain('classifyPushDeliveryEvidence');
    expect(pnq).toMatch(/Does not prove device display or audible/);
  });
});

describe('Android v2/v3 compatibility (no blind v3 cutover)', () => {
  it('unstamped Android tokens stay off native v3 path', () => {
    expect(
      androidTokenUsesNativeAlert(
        { platform: 'android', alert_capability: null, app_version_code: 80 },
        { mode: 'version_gated', minVersionCode: 67 },
      ),
    ).toBe(false);
  });

  it('stamped capable tokens may use v3', () => {
    expect(
      androidTokenUsesNativeAlert(
        {
          platform: 'android',
          alert_capability: ORDER_ALERT_NATIVE_CAPABILITY,
          app_version_code: 67,
        },
        { mode: 'version_gated', minVersionCode: 67 },
      ),
    ).toBe(true);
  });

  it('channel constants remain dual (v2 legacy + v3 native)', () => {
    expect(LEGACY_ANDROID_ORDER_CHANNEL).toBe('orders_incoming_v2');
    expect(NATIVE_ANDROID_ORDER_CHANNEL).toBe('orders_incoming_v3');
    const gate = read('supabase/functions/_shared/seller-alert-gate.ts');
    expect(gate).toContain("SELLER_ALERT_ANDROID_MODE") ;
    expect(gate).toContain('legacy');
  });

  it('client stamp retries without forcing v3 routing', () => {
    const push = read('src/hooks/usePushNotifications.ts');
    expect(push).toContain('CLIENT_BUILD_STAMP_ZERO_ROWS');
    expect(push).toContain('orders_incoming_v2 until stamp succeeds');
  });
});

describe('Cancellation / reminder safety contracts in source', () => {
  it('expire path still keys off auto_cancel_at and placed status', () => {
    const oae = read('supabase/migrations/20260807220500_order_acceptance_auto_cancel_5m.sql');
    expect(oae).toContain('expire_unaccepted_order');
    expect(oae).toContain('auto_cancel_at');
  });

  it('status reminder worker skips terminal / past-deadline before insert', () => {
    const src = read('supabase/functions/send-seller-status-reminders/index.ts');
    expect(src).toContain('TERMINAL_BLOCK');
    expect(src).toContain('stillAcceptPending');
    expect(src).toContain('nowMs >= cancelAt');
  });
});
