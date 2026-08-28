/** Prep time is stored as whole minutes (products.prep_time_minutes is integer). */

export const PREP_TIME_MINUTES_ERROR =
  'Prep time must be a whole number of minutes (e.g. 30), not a decimal.';

export const PREP_TIME_MIN_MINUTES = 1;
export const PREP_TIME_MAX_MINUTES = 1440; // 24 hours

/**
 * Allow only digit characters while typing (blocks ".3", "3.5", etc.).
 */
export function sanitizePrepTimeMinutesInput(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Parse optional prep time for save. Empty → null.
 */
export function parsePrepTimeMinutes(
  raw: string | number | null | undefined,
): { minutes: number | null; error?: string } {
  if (raw === null || raw === undefined) return { minutes: null };

  const s = String(raw).trim();
  if (!s) return { minutes: null };

  if (!/^\d+$/.test(s)) {
    return { minutes: null, error: PREP_TIME_MINUTES_ERROR };
  }

  const minutes = parseInt(s, 10);
  if (!Number.isFinite(minutes) || minutes < PREP_TIME_MIN_MINUTES) {
    return { minutes: null, error: `Prep time must be at least ${PREP_TIME_MIN_MINUTES} minute.` };
  }
  if (minutes > PREP_TIME_MAX_MINUTES) {
    return {
      minutes: null,
      error: `Prep time cannot exceed ${PREP_TIME_MAX_MINUTES} minutes (24 hours).`,
    };
  }

  return { minutes };
}
