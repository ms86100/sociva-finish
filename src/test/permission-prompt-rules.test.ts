import { describe, expect, it } from 'vitest';
import {
  notificationAskCopy,
  notifNeedsAttention,
  shouldDeferNotificationAsk,
  shouldDeferPostLoginPermissionSheet,
  shouldShowHomeLocationBanner,
  shouldShowHomePushEnableCard,
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
    ).toBe(true);
    expect(
      notifNeedsAttention({
        isNative: true,
        notificationPermission: 'denied',
        hasToken: true,
      }),
    ).toBe(true);
  });

  it('respects notif cooldown and stays quiet during checkout', () => {
    expect(
      shouldShowNotifSoftPrompt({
        isNative: true,
        notificationPermission: 'not_requested',
        hasToken: false,
        notifCooldown: true,
      }),
    ).toBe(false);
    expect(
      shouldShowNotifSoftPrompt({
        isNative: true,
        notificationPermission: 'not_requested',
        notifCooldown: false,
        checkoutInProgress: true,
      }),
    ).toBe(false);
    expect(
      shouldShowNotifSoftPrompt({
        isNative: true,
        notificationPermission: 'not_requested',
        notifCooldown: true,
        bypassNotifCooldown: true,
      }),
    ).toBe(true);
  });

  it('shows home Stay in the loop after login even with cooldown', () => {
    expect(
      shouldShowHomePushEnableCard({
        hasUser: false,
        isNative: true,
        notificationPermission: 'not_requested',
        notifCooldown: false,
      }),
    ).toBe(false);
    expect(
      shouldShowHomePushEnableCard({
        hasUser: true,
        isNative: true,
        notificationPermission: 'not_requested',
        notifCooldown: true,
        postLoginAsk: true,
      }),
    ).toBe(true);
    expect(
      shouldShowHomePushEnableCard({
        hasUser: true,
        isNative: true,
        notificationPermission: 'not_requested',
        notifCooldown: true,
        postLoginAsk: false,
      }),
    ).toBe(false);
    expect(
      shouldShowHomePushEnableCard({
        hasUser: true,
        isNative: true,
        notificationPermission: 'enabled',
        notifCooldown: false,
        postLoginAsk: true,
      }),
    ).toBe(false);
  });

  it('defers the ask on cart, address, and checkout, not on home', () => {
    expect(shouldDeferPostLoginPermissionSheet('/cart')).toBe(true);
    expect(shouldDeferPostLoginPermissionSheet('/cart?x=1')).toBe(true);
    expect(shouldDeferNotificationAsk('/profile/edit')).toBe(true);
    expect(shouldDeferNotificationAsk('/checkout')).toBe(true);
    expect(shouldDeferPostLoginPermissionSheet('/')).toBe(false);
    expect(shouldDeferPostLoginPermissionSheet('/profile')).toBe(false);
  });

  it('uses seller copy for incoming orders and buyer copy otherwise', () => {
    expect(notificationAskCopy(true).title).toMatch(/new orders/i);
    expect(notificationAskCopy(false).body).toMatch(/accepted, prepared, or on the way/);
  });
});
