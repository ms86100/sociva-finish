/**
 * Pure rules for permission soft-prompts — unit-tested, no Capacitor.
 */
export type NotificationPermissionState = 'enabled' | 'denied' | 'not_requested' | 'unknown';
export type LocationPermissionState =
  | 'enabled'
  | 'denied'
  | 'not_requested'
  | 'restricted'
  | 'unknown';

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
  hasToken: boolean;
}): boolean {
  if (!opts.isNative) return false;
  if (opts.hasToken) return false;
  // Ignore unknown while OS status is still loading — avoids flash + stuck Enable.
  return (
    opts.notificationPermission === 'not_requested' ||
    opts.notificationPermission === 'denied'
  );
}

export function shouldShowNotifSoftPrompt(opts: {
  isNative: boolean;
  notificationPermission: NotificationPermissionState;
  hasToken: boolean;
  notifCooldown: boolean;
}): boolean {
  if (opts.notifCooldown) return false;
  return notifNeedsAttention(opts);
}
