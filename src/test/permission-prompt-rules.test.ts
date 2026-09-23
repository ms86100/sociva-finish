import { describe, expect, it } from 'vitest';
import {
  notifNeedsAttention,
  shouldDeferPostLoginPermissionSheet,
  shouldShowHomeLocationBanner,
  shouldShowLocSoftPrompt,
  shouldShowNotifSoftPrompt,
} from '@/lib/permission-prompt-rules';

describe('permission soft-prompt rules', () => {
  it('hides location soft prompt while refreshing or on cooldown', () => {
    expect(
      shouldShowLocSoftPrompt({
        locationPermission: 'not_requested',
        locCooldown: false,
        refreshing: true,
      }),
    ).toBe(false);
    expect(
      shouldShowLocSoftPrompt({
        locationPermission: 'not_requested',
        locCooldown: true,
      }),
    ).toBe(false);
  });

  it('does not soft-prompt location while status is still unknown', () => {
    expect(
      shouldShowLocSoftPrompt({
        locationPermission: 'unknown',
        locCooldown: false,
      }),
    ).toBe(false);
  });

  it('soft-prompts location when not_requested or denied', () => {
    expect(
      shouldShowLocSoftPrompt({
        locationPermission: 'not_requested',
        locCooldown: false,
      }),
    ).toBe(true);
    expect(
      shouldShowLocSoftPrompt({
        locationPermission: 'denied',
        locCooldown: false,
      }),
    ).toBe(true);
    expect(
      shouldShowLocSoftPrompt({
        locationPermission: 'enabled',
        locCooldown: false,
      }),
    ).toBe(false);
  });

  it('home banner mirrors location soft-prompt only', () => {
    expect(
      shouldShowHomeLocationBanner({
        locationPermission: 'not_requested',
        locCooldown: false,
      }),
    ).toBe(true);
  });

  it('ignores unknown notification status for attention (avoids stuck Enable)', () => {
    expect(
      notifNeedsAttention({
        isNative: true,
        notificationPermission: 'unknown',
        hasToken: false,
      }),
    ).toBe(false);
    expect(
      notifNeedsAttention({
        isNative: true,
        notificationPermission: 'not_requested',
        hasToken: false,
      }),
    ).toBe(true);
    expect(
      notifNeedsAttention({
        isNative: true,
        notificationPermission: 'enabled',
        hasToken: false,
      }),
    ).toBe(false);
    expect(
      notifNeedsAttention({
        isNative: true,
        notificationPermission: 'not_requested',
        hasToken: true,
      }),
    ).toBe(false);
  });

  it('respects notif cooldown', () => {
    expect(
      shouldShowNotifSoftPrompt({
        isNative: true,
        notificationPermission: 'not_requested',
        hasToken: false,
        notifCooldown: true,
      }),
    ).toBe(false);
  });

  it('defers post-login sheet on cart/checkout paths', () => {
    expect(shouldDeferPostLoginPermissionSheet('/cart')).toBe(true);
    expect(shouldDeferPostLoginPermissionSheet('/cart?x=1')).toBe(true);
    expect(shouldDeferPostLoginPermissionSheet('/')).toBe(false);
    expect(shouldDeferPostLoginPermissionSheet('/profile')).toBe(false);
  });
});
