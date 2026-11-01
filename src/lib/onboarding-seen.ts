/** Shared onboarding-seen key - keep in sync with useOnboarding in OnboardingWalkthrough. */

export function onboardingSeenStorageKey(userId: string): string {
  return `app_has_seen_onboarding_${userId}`;
}

export function hasSeenOnboarding(userId: string | null | undefined): boolean {
  if (!userId) return true;
  try {
    return localStorage.getItem(onboardingSeenStorageKey(userId)) === 'true';
  } catch {
    return true;
  }
}
