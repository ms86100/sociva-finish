// @ts-nocheck
/**
 * Persistent Key-Value helpers for cross-platform compatibility.
 *
 * Reads are synchronous via localStorage (populated from Preferences on native
 * startup before React mounts — see capacitor.ts `restoreAppPreferences`).
 *
 * Writes go to both localStorage (instant, sync) and capacitorStorage
 * (persistent on native). This ensures the value survives iOS WKWebView
 * localStorage purges.
 */
import { capacitorStorage } from './capacitor-storage';

/** Read a string value (sync). */
export function getString(key: string): string | null {
  return localStorage.getItem(key);
}

/** Read a boolean flag (sync). */
export function getFlag(key: string): boolean {
  return localStorage.getItem(key) === 'true';
}

/** Write a string to both localStorage and persistent native storage. */
export function setString(key: string, value: string): void {
  localStorage.setItem(key, value);
  capacitorStorage.setItem(key, value);
}

/** Write a boolean flag. */
export function setFlag(key: string, value: boolean): void {
  setString(key, String(value));
}

/** Remove a key from both stores. */
export function removeKey(key: string): void {
  localStorage.removeItem(key);
  capacitorStorage.removeItem(key);
}

/**
 * Restore app-preference keys from Preferences → localStorage.
 * Called once during `initializeCapacitorPlugins()` on native,
 * before React mounts. After this, all sync `localStorage.getItem`
 * reads return the persisted value.
 */
export async function restoreAppPreferences(): Promise<void> {
  // Known prefixes for app preferences (not auth — auth is handled separately)
  const prefixes = [
    'seller_congrats_seen_',
    'app_large_font',
    'feedback_prompted_',
    'app_has_seen_onboarding',
    'seller_onboarding_completed',
    'seller_onboarding_step',
    'live_activity_map',
    'live_activity_diagnostics',
    'live_activity_diagnostics_errors',
    'status_flow_terminal_cache',
    'status_flow_start_cache',
  ];

  for (const prefix of prefixes) {
    // For exact keys (no user suffix), just restore directly
    const val = await capacitorStorage.getItem(prefix);
    if (val !== null) {
      localStorage.setItem(prefix, val);
    }
  }

  // For user-scoped keys, we scan localStorage for any existing keys
  // and also check Preferences for known patterns.
  // Since we can't enumerate Preferences keys, we rely on the fact that
  // setString() writes to both stores. On first native launch after
  // this fix, localStorage may be empty but Preferences has the value.
  // For user-scoped keys, we need userId which isn't available here.
  // Instead, we'll restore them lazily via a helper.
}

/**
 * Restore a specific key from Preferences → localStorage if not already present.
 * Call this for user-scoped keys where the userId is known.
 */
export async function restoreKeyIfMissing(key: string): Promise<void> {
  if (localStorage.getItem(key) !== null) return;
  const val = await capacitorStorage.getItem(key);
  if (val !== null) {
    localStorage.setItem(key, val);
  }
}
