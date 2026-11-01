import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  clearAppNotificationConsent,
  readAppNotificationConsent,
  resolveNotificationUiPath,
  writeAppNotificationConsent,
} from '@/lib/notification-app-consent';

function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

describe('notification app consent', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', mockStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists deferred and card_dismissed separately from OS state', () => {
    expect(readAppNotificationConsent()).toBe('none');
    writeAppNotificationConsent('deferred');
    expect(readAppNotificationConsent()).toBe('deferred');
    writeAppNotificationConsent('card_dismissed');
    expect(readAppNotificationConsent()).toBe('card_dismissed');
    clearAppNotificationConsent();
    expect(readAppNotificationConsent()).toBe('none');
  });

  it('maps denied OS to settings_required and granted to granted', () => {
    expect(
      resolveNotificationUiPath({ osPermission: 'denied', appConsent: 'none' }),
    ).toBe('settings_required');
    expect(
      resolveNotificationUiPath({ osPermission: 'enabled', appConsent: 'deferred' }),
    ).toBe('granted');
    expect(
      resolveNotificationUiPath({
        osPermission: 'not_requested',
        appConsent: 'card_dismissed',
      }),
    ).toBe('hidden');
  });
});
