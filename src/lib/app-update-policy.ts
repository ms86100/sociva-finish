import { Capacitor } from '@capacitor/core';
import { isVersionBelow } from '@/lib/min-app-version';
import { storeUrlForPlatform, storeUpdateButtons, type StoreUpdateButton } from '@/lib/app-update-link';

const DISMISS_PREFIX = 'sociva_update_dismissed_';

export function updateDismissStorageKey(latestVersion: string): string {
  const v = (latestVersion || '').trim() || 'enabled';
  return `${DISMISS_PREFIX}${v}`;
}

export function isUpdateDismissed(latestVersion: string | null | undefined): boolean {
  try {
    return localStorage.getItem(updateDismissStorageKey(latestVersion || '')) === '1';
  } catch {
    return false;
  }
}

export function dismissUpdateVersion(latestVersion: string | null | undefined): void {
  try {
    localStorage.setItem(updateDismissStorageKey(latestVersion || ''), '1');
  } catch {
    // ignore
  }
}

/**
 * Soft banner visibility. Mandatory force-update stays in MinVersionGate.
 * - enabled must be true
 * - if latest_version is set, installed must be below it (native)
 * - dismissed versions stay hidden
 * - web/PWA: show when enabled and not dismissed (no installed version to compare)
 */
export function shouldShowSoftUpdate(opts: {
  enabled: boolean;
  latestVersion?: string | null;
  installedVersion?: string | null;
  dismissed?: boolean;
  isNative?: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.dismissed) return false;
  const latest = (opts.latestVersion || '').trim();
  if (!latest) return true;
  if (!opts.isNative) return true;
  const installed = (opts.installedVersion || '').trim();
  // Wait for App.getInfo() - never flash the soft banner before version is known.
  if (!installed) return false;
  return isVersionBelow(installed, latest);
}

export function softUpdateButtons(platform: string): StoreUpdateButton[] {
  return storeUpdateButtons(platform);
}

export function softUpdateStoreUrl(platform?: string): string {
  const p = platform || (Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web');
  return storeUrlForPlatform(p);
}

/** Open store URL via Capacitor Browser on native; assign on web. Returns false on failure. */
export async function openAppStoreUrl(url: string): Promise<boolean> {
  const target = (url || '').trim();
  if (!target) return false;
  try {
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: target });
      return true;
    }
    window.location.assign(target);
    return true;
  } catch {
    try {
      window.open(target, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  }
}
