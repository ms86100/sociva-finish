import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { isIosTimeSensitiveSellerAlert } from '../../supabase/functions/_shared/ios-time-sensitive';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('seller priority notify matrix (closed app + gate_bell)', () => {
  it('treats confirmed service bookings as high-priority on server and Android', () => {
    const pnq = read('supabase/functions/process-notification-queue/index.ts');
    expect(pnq).toMatch(/SELLER_HIGH_PRIORITY_STATUSES = \[[^\]]*confirmed/);
    expect(pnq).toMatch(/sellerStatuses = \[[\s\S]*confirmed/);

    const spn = read('supabase/functions/send-push-notification/index.ts');
    expect(spn).toMatch(/SELLER_HP = \[[^\]]*confirmed/);
    expect(spn).toMatch(/sellerStatuses = \[[\s\S]*confirmed/);

    const android = read('android/app/src/main/java/app/sociva/community/OrderAlertMessagingService.java');
    expect(android).toContain('"confirmed".equals(status)');

    const mig = read('supabase/migrations/20261016120000_service_booking_priority_notify.sql');
    expect(mig).toContain("'target_role', 'seller'");
    expect(mig).toContain("'status', 'confirmed'");
    expect(mig).toContain("'high_priority', true");
  });

  it('lets scheduled_prep and scheduled_late ring on native Android when app is closed', () => {
    const reminders = read('supabase/functions/send-scheduled-order-reminders/index.ts');
    expect(reminders).toContain('status: o.status');
    expect(reminders).toContain('reminder_type: w.kind');
    expect(reminders).toContain('high_priority: w.kind === "scheduled_late" || w.kind === "scheduled_prep"');

    const android = read('android/app/src/main/java/app/sociva/community/OrderAlertMessagingService.java');
    expect(android).toContain('"scheduled_prep".equals(reminder)');
    expect(android).toContain('"scheduled_late".equals(reminder)');
    expect(android).toContain('"scheduled_accept".equals(reminder)');

    const pnq = read('supabase/functions/process-notification-queue/index.ts');
    expect(pnq).toContain('payload.reminder_type === "scheduled_prep"');
    expect(pnq).toContain('payload.reminder_type === "scheduled_late"');
    expect(pnq).toContain('payload.reminder_type === "scheduled_accept"');
  });

  it('rings sellers to accept a closed-store scheduled order every 15 minutes in the accept window', () => {
    const statusReminders = read('supabase/functions/send-seller-status-reminders/index.ts');
    expect(statusReminders).toContain('const REMINDER_INTERVAL_MIN = 15');
    expect(statusReminders).toContain('reminder_type: "scheduled_accept"');
    expect(statusReminders).toContain('SCHEDULED_ACCEPT_LEAD_MIN');
    expect(statusReminders).toContain('Accept this scheduled order');
    expect(read('src/hooks/useSellerStatusNudge.ts')).toContain('const NUDGE_INTERVAL_MS = 15 * 60 * 1000');
  });

  it('keeps placed / enquired creation paths on the high-priority allowlist', () => {
    const pnq = read('supabase/functions/process-notification-queue/index.ts');
    for (const status of ['placed', 'enquired', 'requested', 'quoted', 'preparing', 'confirmed']) {
      expect(pnq).toContain(`'${status}'`);
    }

    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'confirmed',
      type: 'order',
      queueType: 'order',
    })).toBe(true);

    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'placed',
      type: 'order',
      queueType: 'order',
    })).toBe(true);

    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'enquired',
      type: 'order',
      queueType: 'order',
    })).toBe(true);
  });
});
