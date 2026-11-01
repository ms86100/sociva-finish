import type {
  HelpHubAvailability,
  HelpHubCategory,
  HelpHubSource,
  HelpHubWorkType,
} from './types';

export const HELPHUB_CONSENT_VERSION = 'helphub_consent_v1';

export const HELPHUB_CONSENT_TEXT =
  'I confirm that this person has agreed to be listed on Sociva and to receive employment enquiries.';

export const HELPHUB_LISTING_DAYS = 30;

export const HELPHUB_CATEGORIES: { value: HelpHubCategory; label: string }[] = [
  { value: 'maid', label: 'Maid / Housekeeping' },
  { value: 'cook', label: 'Cook' },
  { value: 'nanny', label: 'Nanny' },
  { value: 'babysitter', label: 'Babysitter' },
  { value: 'driver', label: 'Driver' },
  { value: 'elderly_care', label: 'Elderly Care' },
  { value: 'caretaker', label: 'Caretaker' },
  { value: 'gardener', label: 'Gardener' },
  { value: 'laundry', label: 'Laundry / Ironing' },
  { value: 'other', label: 'Other' },
];

export const HELPHUB_WORK_TYPES: { value: HelpHubWorkType; label: string }[] = [
  { value: 'part_time', label: 'Part-time' },
  { value: 'full_time', label: 'Full-time' },
  { value: 'live_in', label: 'Live-in' },
  { value: 'hourly', label: 'Hourly' },
];

export const HELPHUB_AVAILABILITY: { value: HelpHubAvailability; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'flexible', label: 'Flexible' },
];

/** Suggested clock window when a period chip is chosen (HH:MM, 24h). */
export const HELPHUB_AVAILABILITY_DEFAULT_HOURS: Record<
  HelpHubAvailability,
  { from: string; to: string } | null
> = {
  morning: { from: '07:00', to: '11:00' },
  afternoon: { from: '12:00', to: '16:00' },
  evening: { from: '17:00', to: '21:00' },
  flexible: null,
};

/** Normalize HTML time input / DB time to HH:MM. */
export function normalizeHelpHubTime(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Display "7:00 AM - 11:00 AM" (or single side if only one set). */
export function formatHelpHubHours(
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  const a = normalizeHelpHubTime(from);
  const b = normalizeHelpHubTime(to);
  if (!a && !b) return null;
  const fmt = (hhmm: string) => {
    const [hs, ms] = hhmm.split(':').map(Number);
    const suffix = hs >= 12 ? 'PM' : 'AM';
    const h12 = hs % 12 || 12;
    return `${h12}:${String(ms).padStart(2, '0')} ${suffix}`;
  };
  if (a && b) return `${fmt(a)} - ${fmt(b)}`;
  if (a) return `From ${fmt(a)}`;
  return `Until ${fmt(b!)}`;
}

export const HELPHUB_SOURCE_LABELS: Record<HelpHubSource, string> = {
  resident_recommendation: 'Recommended by a resident',
  self_registered: 'Self registered',
  assisted: 'Resident recommendation',
};

export const HELPHUB_REPORT_REASONS = [
  'Incorrect information',
  'Spam',
  'Fraud or suspicious activity',
  'Harassment',
  'Inappropriate content',
  'Other',
] as const;

/** Normalize and lightly validate an Indian mobile number. Returns digits or null. */
export function normalizeHelpHubPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (local.length === 10 && /^[6-9]/.test(local)) return local;
  return null;
}

/**
 * Post-call outcomes for residents.
 * Keep wording neighborly and factual - no blame, no verification claims.
 */
export const HELPHUB_CALL_FEEDBACK_OPTIONS = [
  {
    value: 'moving_forward',
    label: 'Spoke - we are moving forward',
    hint: 'You may hire or meet them next',
  },
  {
    value: 'not_the_right_fit',
    label: 'Spoke - not the right fit for now',
    hint: 'Timing, duties, or expectations did not match',
  },
  {
    value: 'could_not_reach',
    label: 'Could not reach them',
    hint: 'No answer, busy, or call did not connect',
  },
  {
    value: 'number_issue',
    label: 'Number seems wrong or not working',
    hint: 'Invalid, switched off, or belongs to someone else',
  },
  {
    value: 'no_longer_available',
    label: 'They are no longer available',
    hint: 'Already placed, left the society, or paused looking',
  },
  {
    value: 'other',
    label: 'Other',
    hint: 'Tell us briefly what happened',
  },
] as const;

export type HelpHubCallFeedbackValue =
  (typeof HELPHUB_CALL_FEEDBACK_OPTIONS)[number]['value'];

/** Roles residents search most often - shown as quick shortcuts */
export const HELPHUB_QUICK_ROLES = [
  { value: 'all', label: 'All' },
  { value: 'cook', label: 'Cook' },
  { value: 'maid', label: 'Maid' },
  { value: 'nanny', label: 'Nanny' },
  { value: 'driver', label: 'Driver' },
  { value: 'babysitter', label: 'Babysitter' },
] as const;
