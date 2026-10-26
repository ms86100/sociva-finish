/**
 * Pure rules for permission soft-prompts - unit-tested, no Capacitor.
 */
export type NotificationPermissionState = 'enabled' | 'denied' | 'not_requested' | 'unknown';
export type LocationPermissionState =
  | 'enabled'
  | 'denied'
  | 'not_requested'
  | 'restricted'
  | 'unknown';

/** A few days. Saying no hides the home ask, then it comes back. */
export const NOTIF_ASK_AGAIN_MS = 3 * 24 * 60 * 60 * 1000;

export function shouldDeferPostLoginPermissionSheet(pathname: string): boolean {
  const path = (pathname || '/').split('?')[0];
  return (
    path === '/cart' ||
    path.startsWith('/cart/') ||
    path === '/profile/edit' ||
    path.startsWith('/checkout')
  );
}

/** Cart, delivery address, and checkout must not be interrupted by the ask. */
export function shouldDeferNotificationAsk(pathname: string): boolean {
  return shouldDeferPostLoginPermissionSheet(pathname);
}

export function shouldShowLocSoftPrompt(opts: {
  locationPermission: LocationPermissionState;
  locCooldown: boolean;
  refreshing?: boolean;
}): boolean {
  if (opts.refreshing) return false;
  if (opts.locCooldown) return false;
  return (
    opts.locationPermission === 'not_requested' ||
    opts.locationPermission === 'denied' ||
    opts.locationPermission === 'restricted'
  );
}

/** Home banner: location only. */
export function shouldShowHomeLocationBanner(opts: {
  locationPermission: LocationPermissionState;
  locCooldown: boolean;
  refreshing?: boolean;
}): boolean {
  return shouldShowLocSoftPrompt(opts);
}

export function notifNeedsAttention(opts: {
  isNative: boolean;
  notificationPermission: NotificationPermissionState;
  hasToken?: boolean;
}): boolean {
  if (!opts.isNative) return false;
  // Allowed means stop asking, even if the token has not been saved yet.
  if (opts.notificationPermission === 'enabled') return false;
  // Ignore unknown while OS status is still loading - avoids flash + stuck Enable.
  return (
    opts.notificationPermission === 'not_requested' ||
    opts.notificationPermission === 'denied'
  );
}

export function notificationAskCopy(isSeller: boolean): { title: string; body: string } {
  if (isSeller) {
    return {
      title: 'Hear new orders instantly',
      body: 'Turn on notifications and the order bell rings when a new order arrives, even if the app is closed.',
    };
  }
  return {
    title: 'Stay in the loop',
    body: 'Turn on notifications and you will know the moment an order is accepted, prepared, or on the way.',
  };
}

export function shouldShowNotifSoftPrompt(opts: {
  isNative: boolean;
  notificationPermission: NotificationPermissionState;
  hasToken?: boolean;
  notifCooldown: boolean;
  checkoutInProgress?: boolean;
  /** After login, show even if "Not now" / sheet cooldown is active. */
  bypassNotifCooldown?: boolean;
}): boolean {
  if (opts.notifCooldown && !opts.bypassNotifCooldown) return false;
  if (opts.checkoutInProgress) return false;
  return notifNeedsAttention(opts);
}

/**
 * Home "Stay in the loop" card - only for signed-in users on native,
 * after any login path, until they Allow or tap Not now on this card.
 */
export function shouldShowHomePushEnableCard(opts: {
  hasUser: boolean;
  isNative: boolean;
  notificationPermission: NotificationPermissionState;
  hasToken?: boolean;
  notifCooldown: boolean;
  checkoutInProgress?: boolean;
  postLoginAsk?: boolean;
}): boolean {
  if (!opts.hasUser) return false;
  return shouldShowNotifSoftPrompt({
    isNative: opts.isNative,
    notificationPermission: opts.notificationPermission,
    hasToken: opts.hasToken,
    notifCooldown: opts.notifCooldown,
    checkoutInProgress: opts.checkoutInProgress,
    bypassNotifCooldown: !!opts.postLoginAsk,
  });
}
