/**
 * Pure rules for permission soft-prompts - unit-tested, no Capacitor.
 *
 * OS notification states (do not confuse with app consent):
 * not_requested | enabled (granted) | denied | unknown
 *
 * App consent (localStorage via notification-app-consent):
 * none | deferred | card_dismissed
 *
 * UI path settings_required = OS denied (open system settings, never re-prompt OS).
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

/** Buyer Stay in the Loop home card copy (exact). */
export const STAY_IN_THE_LOOP_COPY = {
  title: 'Stay in the Loop!',
  body: 'Never miss order updates, fresh food alerts and important community news.',
  cta: 'Turn On Notifications',
  secondary: 'Not Now',
} as const;

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
    title: STAY_IN_THE_LOOP_COPY.title,
    body: STAY_IN_THE_LOOP_COPY.body,
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
 * Home "Stay in the Loop" card - only for signed-in users on native,
 * after onboarding, until they grant OS permission or dismiss the card.
 */
export function shouldShowHomePushEnableCard(opts: {
  hasUser: boolean;
  isNative: boolean;
  notificationPermission: NotificationPermissionState;
  hasToken?: boolean;
  notifCooldown: boolean;
  checkoutInProgress?: boolean;
  postLoginAsk?: boolean;
  /** When true, permanently hide (Not Now / close on card). */
  cardDismissed?: boolean;
  /** Onboarding incomplete - never show notification UI. */
  onboardingIncomplete?: boolean;
}): boolean {
  if (!opts.hasUser) return false;
  if (opts.onboardingIncomplete) return false;
  if (opts.cardDismissed) return false;
  if (opts.notificationPermission === 'enabled') return false;
  return shouldShowNotifSoftPrompt({
    isNative: opts.isNative,
    notificationPermission: opts.notificationPermission,
    hasToken: opts.hasToken,
    notifCooldown: opts.notifCooldown,
    checkoutInProgress: opts.checkoutInProgress,
    bypassNotifCooldown: !!opts.postLoginAsk,
  });
}
