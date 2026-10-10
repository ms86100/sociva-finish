const STORAGE_KEY = 'sociva_section_opened_at';

export type SectionVisitKey = 'home' | 'book' | 'contact';

type StampMap = Partial<Record<SectionVisitKey, number>>;

function readMap(): StampMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Previous time this destination was opened, before the current visit. */
export function readSectionOpenedAt(section: SectionVisitKey): number | null {
  const value = readMap()[section];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function markSectionOpened(section: SectionVisitKey, now = Date.now()): void {
  try {
    const next = readMap();
    next[section] = now;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Visit history is best-effort on this device.
  }
}
