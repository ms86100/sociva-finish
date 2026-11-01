/**
 * App-level notification consent - separate from OS permission.
 * OS: not_requested | enabled (granted) | denied | unknown
 * App: deferred | card_dismissed | none
 */

export type AppNotificationConsent = 'none' | 'deferred' | 'card_dismissed';

const APP_STATE_KEY = 'sociva_notif_app_state';

export function readAppNotificationConsent(): AppNotificationConsent {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (raw === 'deferred' || raw === 'card_dismissed') return raw;
  } catch {
    // ignore
  }
  return 'none';
}

export function writeAppNotificationConsent(state: AppNotificationConsent): void {
  try {
    if (state === 'none') localStorage.removeItem(APP_STATE_KEY);
    else localStorage.setItem(APP_STATE_KEY, state);
  } catch {
    // ignore
  }
}

export function clearAppNotificationConsent(): void {
  writeAppNotificationConsent('none');
}

/** UI path after OS denied - never re-request native permission. */
export type NotificationUiPath = 'prompt' | 'settings_required' | 'hidden' | 'granted';

export function resolveNotificationUiPath(opts: {
  osPermission: 'enabled' | 'denied' | 'not_requested' | 'unknown';
  appConsent: AppNotificationConsent;
}): NotificationUiPath {
  if (opts.osPermission === 'enabled') return 'granted';
  if (opts.osPermission === 'denied') return 'settings_required';
  if (opts.appConsent === 'card_dismissed') return 'hidden';
  if (opts.osPermission === 'not_requested' || opts.osPermission === 'unknown') {
    if (opts.appConsent === 'deferred') return 'prompt';
    return 'prompt';
  }
  return 'prompt';
}
