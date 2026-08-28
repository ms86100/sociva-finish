export type LeadTimeUnit = 'minutes' | 'hours';

/** DB stores lead time as hours (numeric — supports fractions e.g. 0.5 = 30 min). */
export function leadTimeToHours(value: number, unit: LeadTimeUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit === 'minutes') return Math.round((value / 60) * 100) / 100;
  return value;
}

export function leadTimeFromHours(hours: number | null | undefined): { value: string; unit: LeadTimeUnit } {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) {
    return { value: '', unit: 'hours' };
  }
  if (hours < 1) {
    return { value: String(Math.round(hours * 60)), unit: 'minutes' };
  }
  const whole = Math.round(hours);
  return { value: String(whole === hours ? whole : hours), unit: 'hours' };
}

export function formatLeadTime(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} min`;
  }
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} hr${rounded === 1 ? '' : 's'}`;
}

export const LEAD_TIME_VALUE_ERROR = 'Lead time must be a positive number (whole minutes or hours).';

/** Parse seller lead-time input for save. Empty → null. */
export function parseLeadTimeInput(
  raw: string | number | null | undefined,
  unit: LeadTimeUnit,
): { hours: number | null; error?: string } {
  if (raw === null || raw === undefined) return { hours: null };
  const s = String(raw).trim();
  if (!s) return { hours: null };

  const value = parseFloat(s);
  if (!Number.isFinite(value) || value <= 0) {
    return { hours: null, error: LEAD_TIME_VALUE_ERROR };
  }

  const hours = leadTimeToHours(value, unit);
  if (hours == null || hours <= 0) {
    return { hours: null, error: LEAD_TIME_VALUE_ERROR };
  }

  return { hours };
}

/** Buyer-facing phrase for minimum advance notice. */
export function formatLeadTimeAdvanceNotice(hours: number | null | undefined): string {
  const formatted = formatLeadTime(hours);
  if (!formatted) return 'advance notice required';
  return `at least ${formatted} advance notice`;
}
