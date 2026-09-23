/**
 * Strip / block sensitive fields before Amplitude ingest or Session Replay metadata.
 */

const BLOCKED_KEY =
  /authorization|cookie|token|secret|password|otp|pin|cvv|card|pan|vpa|upi|iban|account_number|ifsc|phone|email|address_line|full_address|raw_address/i;

const MAX_STRING = 200;

export function sanitizeAnalyticsProps(
  props?: Record<string, unknown> | null,
): Record<string, string | number | boolean | null> {
  if (!props || typeof props !== 'object') return {};

  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(props)) {
    if (BLOCKED_KEY.test(key)) continue;
    if (value === undefined) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      // Drop strings that look like OTPs / long secrets
      if (/^\d{4,8}$/.test(trimmed) && /otp|code|pin/i.test(key)) continue;
      out[key] = trimmed.length > MAX_STRING ? `${trimmed.slice(0, MAX_STRING)}…` : trimmed;
      continue;
    }
    // Skip nested objects/arrays - keep payload flat and safe
  }
  return out;
}
