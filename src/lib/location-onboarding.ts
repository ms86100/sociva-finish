/** First-launch location discovery gate (local only - no server). */

const DONE_KEY = 'sociva_location_onboarding_done_v1';
const PENDING_RETURN_KEY = 'sociva_pending_browse_return';

export function isLocationOnboardingDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markLocationOnboardingDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // ignore
  }
}

export function needsLocationOnboarding(hasBrowsingCoords: boolean): boolean {
  if (hasBrowsingCoords) return false;
  return !isLocationOnboardingDone();
}

/** Paths that must open even before the guest picks a pin (shared product / store). */
export function isLocationOnboardingExemptPath(pathname: string): boolean {
  const path = (pathname || '/').split('?')[0] || '/';
  if (path.startsWith('/product/')) return true;
  if (/^\/seller\/[^/]+\/?$/.test(path)) return true;
  return false;
}

/** Remember where to return after /discover-location (share links, deep browse). */
export function setPendingBrowseReturn(path: string): void {
  try {
    const clean = (path || '').split('?')[0] || '/';
    if (!clean.startsWith('/') || clean === '/discover-location') return;
    sessionStorage.setItem(PENDING_RETURN_KEY, clean);
  } catch {
    // ignore
  }
}

export function consumePendingBrowseReturn(fallback = '/'): string {
  try {
    const path = sessionStorage.getItem(PENDING_RETURN_KEY);
    if (path) sessionStorage.removeItem(PENDING_RETURN_KEY);
    if (path && path.startsWith('/') && path !== '/discover-location') return path;
  } catch {
    // ignore
  }
  return fallback;
}
