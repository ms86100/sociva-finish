/**
 * Text inputs with a numeric keypad (inputMode) instead of type="number",
 * which accepts e/+/- and changes value on wheel/trackpad scroll.
 */

/** Digits and at most one decimal point, e.g. prices and fees. */
export function sanitizeDecimalInput(raw: string): string {
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

/** Digits only, e.g. counts, minutes, hours, pincode. */
export function sanitizeWholeNumberInput(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}
