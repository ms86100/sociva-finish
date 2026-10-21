export const SOCIVA_VOICE_LEAD_STATUSES = [
  'new',
  'in_review',
  'store_setup',
  'closed',
] as const;

export type SocivaVoiceLeadStatus = (typeof SOCIVA_VOICE_LEAD_STATUSES)[number];

export const MAX_VOICE_LEADS_PER_PHONE_PER_HOUR = 3;
export const MAX_VOICE_LEADS_PER_IP_PER_HOUR = 8;

export interface SocivaVoiceLeadInput {
  full_name: string;
  phone: string;
  society_name: string;
}

export interface SocivaVoiceLeadValidation {
  ok: boolean;
  errors: Partial<Record<keyof SocivaVoiceLeadInput, string>>;
  value: SocivaVoiceLeadInput | null;
}

/** Strip country code, spaces, and punctuation down to a 10-digit Indian mobile. */
export function normalizeIndianPhone(input: string): string {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function isValidIndianMobile(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

function clipText(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

export function validateSocivaVoiceLead(input: {
  full_name?: string;
  phone?: string;
  society_name?: string;
}): SocivaVoiceLeadValidation {
  const errors: SocivaVoiceLeadValidation['errors'] = {};
  const full_name = clipText(String(input.full_name || ''), 80);
  const society_name = clipText(String(input.society_name || ''), 120);
  const phone = normalizeIndianPhone(String(input.phone || ''));

  if (full_name.length < 2) errors.full_name = 'Please enter your name';
  if (!isValidIndianMobile(phone)) errors.phone = 'Enter a valid 10-digit mobile number';
  if (society_name.length < 2) errors.society_name = 'Please enter your society name';

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, value: null };
  }

  return {
    ok: true,
    errors: {},
    value: { full_name, phone, society_name },
  };
}

export function isSocivaVoiceLeadStatus(value: string): value is SocivaVoiceLeadStatus {
  return (SOCIVA_VOICE_LEAD_STATUSES as readonly string[]).includes(value);
}
