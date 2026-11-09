export type CleanerCityIntent = 'guest' | 'host' | 'both';

const KEY = 'cleaner_city_commute_intent';

export function setCleanerCityIntent(intent: CleanerCityIntent) {
  try {
    sessionStorage.setItem(KEY, intent);
  } catch {
    // ignore
  }
}

export function getCleanerCityIntent(): CleanerCityIntent | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v === 'guest' || v === 'host' || v === 'both') return v;
  } catch {
    // ignore
  }
  return null;
}

export function clearCleanerCityIntent() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
