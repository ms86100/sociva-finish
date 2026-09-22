/** First-launch location discovery gate (local only — no server). */

const DONE_KEY = 'sociva_location_onboarding_done_v1';

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
