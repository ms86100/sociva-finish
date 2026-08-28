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
