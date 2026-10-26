import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('seller notification reliability remediations (2026-10-24)', () => {
  const migration = read(
    'supabase/migrations/20261024083725_seller_notification_reliability_remediation.sql',
  );

  it('stamps Android capability onto matching or recent Android tokens and returns updated count', () => {
    expect(migration).toContain('RETURNS jsonb');
    expect(migration).toContain("p_alert_capability = 'order_alert_native_v1'");
    expect(migration).toContain("platform = 'android'");
    expect(migration).toContain("jsonb_build_object('updated', v_updated)");
    expect(migration).not.toContain('ELSE NULL');

    const hook = read('src/hooks/usePushNotifications.ts');
    expect(hook).toContain('CLIENT_BUILD_STAMP_OK');
    expect(hook).toContain('CLIENT_BUILD_STAMP_ZERO_ROWS');
    expect(hook).toContain('CLIENT_BUILD_STAMP_FAILED');
  });

  it('skips product-order enqueue for booking item inserts and keeps New Booking Confirmed', () => {
    expect(migration).toContain("v_order_type = 'booking' OR v_txn = 'service_booking'");
    expect(migration).toContain('enqueue_seller_new_order_notification');
    const bookingMig = read('supabase/migrations/20261016120000_service_booking_priority_notify.sql');
    expect(bookingMig).toContain("'high_priority', true");
    expect(bookingMig).toContain('New Booking Confirmed');
  });

  it('notifies the seller when a service booking is rescheduled', () => {
    expect(migration).toContain("status_key = 'rescheduled'");
    expect(migration).toContain('notify_seller = true');
    expect(migration).toContain('Appointment rescheduled');
  });

  it('runs scheduled-order Event B every 5 minutes', () => {
    expect(migration).toContain('send_scheduled_order_reminders_every_5m');
    expect(migration).toContain("'*/5 * * * *'");
    expect(migration).toContain('send_scheduled_order_reminders_hourly');
  });

  it('keeps v2 payloads for unstamped Android tokens and still creates v2 natively', () => {
    const gate = read('supabase/functions/_shared/seller-alert-gate.ts');
    expect(gate).toContain('LEGACY_ANDROID_ORDER_CHANNEL = "orders_incoming_v2"');
    expect(gate).toContain('NATIVE_ANDROID_ORDER_CHANNEL = "orders_incoming_v3"');

    const channels = read('android/app/src/main/java/app/sociva/community/OrderAlertChannels.java');
    expect(channels).toContain('CHANNEL_ID = "orders_incoming_v3"');
    expect(channels).toContain('LEGACY_CHANNEL_ID = "orders_incoming_v2"');
    expect(channels).toContain('/raw/gate_bell');
    expect(channels).not.toContain('gate_bell.caf');
  });

  it('does not treat missing tokens as processed and does not drop a second phone', () => {
    const pnq = read('supabase/functions/process-notification-queue/index.ts');
    expect(pnq).toContain('No device token for seller order alert');
    expect(pnq).toContain("status: \"blocked\"");
    expect(pnq).toContain('seenToken');
    expect(pnq).toContain('MAX_PUSH_TOKENS = 8');
    expect(pnq).toContain('x-cron-secret');
    expect(pnq).toContain("targetRole === 'seller' && reminderType === 'scheduled_prep'");
    expect(pnq).toContain('flaggedHighPriority && targetRole !== \'buyer\'');

    const spn = read('supabase/functions/send-push-notification/index.ts');
    expect(spn).toContain('skip_reason: "no_tokens"');
    expect(spn).toContain('MAX_PUSH_TOKENS = 8');
    expect(spn).toContain('seenToken');
    expect(spn).not.toContain('seenPlatform');
    expect(spn).toContain("data?.target_role === 'buyer'");
  });
});
