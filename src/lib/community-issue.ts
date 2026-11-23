/** Community issue meter + status trail helpers (maintenance/alert posts). */

export const ISSUE_VOTE_THRESHOLD = 100;
export const ISSUE_ASK_COMMITTEE_MIN = 25;

export const METER_CATEGORIES = new Set(['maintenance', 'alert']);
export const CONVERTIBLE_CATEGORIES = new Set(['maintenance', 'alert', 'find_help']);

/** Live snag_tickets statuses mapped to resident-facing trail labels */
export const ISSUE_TRAIL = [
  { key: 'reported', label: 'Opened' },
  { key: 'acknowledged', label: 'In review' },
  { key: 'in_progress', label: 'Being fixed' },
  { key: 'resolved', label: 'Confirm fix' },
  { key: 'closed', label: 'Closed' },
] as const;

export type IssueTrailKey = (typeof ISSUE_TRAIL)[number]['key'];

export function isMeterCategory(category: string | null | undefined): boolean {
  return !!category && METER_CATEGORIES.has(category);
}

export function getConvertedSnagId(structured: any): string | null {
  const id = structured?.converted_snag_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function getSnagStatus(structured: any): string | null {
  const s = structured?.snag_status;
  return typeof s === 'string' ? s : null;
}

export function trailIndexForStatus(status: string | null | undefined): number {
  if (!status) return 0;
  const idx = ISSUE_TRAIL.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

export function snagDeepLink(snagId: string): string {
  return `/society/snags?id=${encodeURIComponent(snagId)}`;
}
