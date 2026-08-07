import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  fetchNotificationPreferences,
  mapNotificationPreferencesRow,
  withTimeout,
} from '@/lib/notification-preferences';

describe('mapNotificationPreferencesRow', () => {
  it('returns defaults for null/undefined', () => {
    expect(mapNotificationPreferencesRow(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(mapNotificationPreferencesRow(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('maps quiet hours and falls back missing booleans', () => {
    expect(
      mapNotificationPreferencesRow({
        orders: false,
        quiet_hours_enabled: true,
        quiet_hours_start: 21,
        quiet_hours_end: 6,
      }),
    ).toEqual({
      orders: false,
      chat: true,
      promotions: true,
      sounds: true,
      quiet_hours_enabled: true,
      quiet_hours_start: 21,
      quiet_hours_end: 6,
    });
  });
});

describe('withTimeout', () => {
  it('resolves when promise wins', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'fast')).resolves.toBe(42);
  });

  it('rejects when timer wins', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<number>(() => {}), 50, 'slow');
    const assertion = expect(pending).rejects.toThrow(/timed out after 50ms/);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    vi.useRealTimers();
  });
});

describe('fetchNotificationPreferences', () => {
  it('rejects when client hangs past timeout', async () => {
    vi.useFakeTimers();
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => new Promise(() => {}),
          }),
        }),
      }),
    };

    const pending = fetchNotificationPreferences(client as any, 'user-1', 100);
    const assertion = expect(pending).rejects.toThrow(/timed out after 100ms/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    vi.useRealTimers();
  });

  it('maps a successful row', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                orders: false,
                chat: true,
                promotions: false,
                sounds: true,
                quiet_hours_enabled: true,
                quiet_hours_start: 23,
                quiet_hours_end: 8,
              },
              error: null,
            }),
          }),
        }),
      }),
    };

    await expect(fetchNotificationPreferences(client as any, 'user-1', 1000)).resolves.toEqual({
      orders: false,
      chat: true,
      promotions: false,
      sounds: true,
      quiet_hours_enabled: true,
      quiet_hours_start: 23,
      quiet_hours_end: 8,
    });
  });
});
