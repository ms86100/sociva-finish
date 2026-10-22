/**
 * Chip and listing placeholders when a photo URL is missing or fails to load.
 * Travel / contact-seller rows were seeded with Unsplash URLs and word
 * placeholders such as "plane". Failed images must not become a "?" glyph.
 */

const CATEGORY_LUCIDE: Record<string, string> = {
  airport_transfers: 'Plane',
  local_trips: 'Building2',
  sightseeing: 'Mountain',
  outstation: 'CarFront',
  self_drive: 'KeyRound',
  driver_hire: 'UserRound',
  vehicle_rental: 'Car',
  'other-travel': 'Car',
  travel: 'Car',
};

const WORD_GLYPH: Record<string, string> = {
  plane: '✈️',
  city: '🏙️',
  mountain: '🏔️',
  road: '🛣️',
  key: '🔑',
  driver: '🚗',
  taxi: '🚕',
};

function isEmoji(value: string | null | undefined): boolean {
  if (!value) return false;
  const code = value.codePointAt(0) ?? 0;
  return code > 127;
}

function isLucideName(value: string | null | undefined): boolean {
  return !!value && /^[A-Z][A-Za-z0-9]+$/.test(value);
}

/** Lucide PascalCase name for a category chip. Never an emoji, never a raw word. */
export function categoryLucideName(
  category?: string | null,
  icon?: string | null,
): string {
  if (category && CATEGORY_LUCIDE[category]) return CATEGORY_LUCIDE[category];
  if (isLucideName(icon)) return icon as string;
  return 'Package';
}

/** Visible glyph for empty listing frames. Words such as "plane" become emoji. */
export function listingPlaceholderGlyph(
  category?: string | null,
  placeholderEmoji?: string | null,
): string {
  if (isEmoji(placeholderEmoji)) return placeholderEmoji as string;
  const word = String(placeholderEmoji || '').trim().toLowerCase();
  if (word && WORD_GLYPH[word]) return WORD_GLYPH[word];
  if (category === 'airport_transfers') return '✈️';
  if (category === 'self_drive') return '🔑';
  if (category === 'driver_hire') return '🚗';
  if (category === 'local_trips') return '🏙️';
  if (category === 'sightseeing') return '🏔️';
  if (category === 'outstation') return '🛣️';
  if (category === 'vehicle_rental' || category === 'travel' || category === 'other-travel') return '🚕';
  return '📦';
}
