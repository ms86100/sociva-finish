import type { FilterState } from '@/components/search/SearchFilters';

const STORAGE_KEY = 'sociva_search_journey_v1';

export type SearchJourneySnapshot = {
  filters: FilterState;
  selectedCategory: string | null;
};

type Store = Record<string, SearchJourneySnapshot>;

function readStore(): Store {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function searchJourneyKey(query: string): string {
  return (query || '').trim().toLowerCase();
}

export function isJourneyBack(navigationType: string, state: unknown): boolean {
  const fromState = state && typeof state === 'object' ? (state as { socivaBack?: boolean }).socivaBack : false;
  return navigationType === 'POP' || fromState === true;
}

export function readSearchJourney(query: string): SearchJourneySnapshot | null {
  const snap = readStore()[searchJourneyKey(query)];
  if (!snap || !snap.filters) return null;
  return snap;
}

export function writeSearchJourney(query: string, snapshot: SearchJourneySnapshot): void {
  try {
    const store = readStore();
    store[searchJourneyKey(query)] = snapshot;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota */
  }
}
