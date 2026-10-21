import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  IOS_APNS_SOUND_FILE,
  iosApnsSound,
  isIosTimeSensitiveSellerAlert,
} from '../../supabase/functions/_shared/ios-time-sensitive';

const root = resolve(__dirname, '../..');

describe('iOS Time Sensitive seller alerts', () => {
  it('interrupts only for seller placed, enquired, requested, and confirmed order events', () => {
    for (const status of ['placed', 'enquired', 'requested', 'confirmed']) {
      expect(isIosTimeSensitiveSellerAlert({
        targetRole: 'seller',
        status,
        type: 'order',
        queueType: 'order',
      })).toBe(true);
      expect(isIosTimeSensitiveSellerAlert({
        targetRole: 'seller',
        status,
        queueType: 'order_status',
      })).toBe(true);
    }
  });

  it('lets an unacknowledged reminder interrupt only for those same statuses', () => {
    for (const status of ['placed', 'enquired', 'requested', 'confirmed']) {
      expect(isIosTimeSensitiveSellerAlert({
        targetRole: 'seller',
        status,
        type: 'seller_order_status_reminder',
        queueType: 'seller_order_status_reminder',
        reminderType: 'unacked_order',
      })).toBe(true);
    }
    for (const status of ['quoted', 'preparing', 'accepted']) {
      expect(isIosTimeSensitiveSellerAlert({
        targetRole: 'seller',
        status,
        type: 'seller_order_status_reminder',
        reminderType: 'unacked_order',
      })).toBe(false);
    }
  });

  it('does not treat high priority, quoted, preparing, buyer, refund, or lifecycle as Time Sensitive', () => {
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'placed',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'quoted',
      type: 'order',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'preparing',
      type: 'order',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'buyer',
      status: 'placed',
      type: 'order',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'buyer',
      status: 'enquired',
      type: 'order_status',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'placed',
      type: 'refund_request',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'refund_requested',
      type: 'order',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'placed',
      type: 'seller_approved',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'placed',
      type: 'seller_order_status_reminder',
      reminderType: 'status_nudge',
    })).toBe(false);
    expect(isIosTimeSensitiveSellerAlert({
      targetRole: 'seller',
      status: 'placed',
      reminderType: 'scheduled_prep',
      type: 'seller_scheduled_prep',
    })).toBe(false);
  });

  it('names the iOS CAF and leaves the default sound for ordinary alerts', () => {
    expect(IOS_APNS_SOUND_FILE).toBe('gate_bell.caf');
    expect(iosApnsSound(true)).toBe('gate_bell.caf');
    expect(iosApnsSound(false)).toBe('default');
  });

  it('keeps Android on the MP3 resource while both iOS senders use the shared policy', () => {
    for (const rel of [
      'supabase/functions/process-notification-queue/index.ts',
      'supabase/functions/send-push-notification/index.ts',
    ]) {
      const source = readFileSync(resolve(root, rel), 'utf8');
      expect(source).toContain('iosApnsSound');
      expect(source).toContain('isIosTimeSensitiveSellerAlert');
      expect(source).toContain('"interruption-level": "time-sensitive"');
      expect(source).not.toContain('gate_bell.mp3');
      expect(source).toContain('highPriority ? "gate_bell" : "default"');
    }
    const local = readFileSync(resolve(root, 'src/lib/local-order-notifications.ts'), 'utf8');
    expect(local).toContain("platform === 'ios' ? 'gate_bell.caf' : ORDERS_INCOMING_SOUND");
    const channels = readFileSync(resolve(root, 'src/lib/notification-channel-settings.ts'), 'utf8');
    expect(channels).toContain("export const ORDERS_INCOMING_SOUND = 'gate_bell'");
    const androidChannel = readFileSync(
      resolve(root, 'android/app/src/main/java/app/sociva/community/OrderAlertChannels.java'),
      'utf8',
    );
    expect(androidChannel).toContain('/raw/gate_bell');
    expect(androidChannel).not.toContain('gate_bell.caf');
    const web = readFileSync(resolve(root, 'src/hooks/useNewOrderAlert.ts'), 'utf8');
    expect(web).toContain("'/sounds/gate_bell.mp3'");
  });
});
