/**
 * Legacy mockup-preview flag cleanup.
 * Sample rides are no longer injectable in resident Cleaner City screens.
 */

const MOCKUP_FLAG = 'cleaner-city-mockup-preview';

/** Clears any leftover mockup preview session flag from older builds. */
export function clearCleanerCityMockupPreview() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(MOCKUP_FLAG);
    const params = new URLSearchParams(window.location.search);
    if (params.has('mockup')) {
      params.delete('mockup');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', next);
    }
  } catch {
    // ignore
  }
}
