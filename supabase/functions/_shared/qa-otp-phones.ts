/** Staging/QA OTP bypass phones. Gated by ALLOW_OTP_BYPASS. Rate limits stay on the real MSG91 path. */
export const QA_OTP_BYPASS_PHONES = [
  "0123456789",
  "0987654321",
  "9876543201",
  "8448802907",
  // Staging join E2E - approved registry, pending membership, no maps
  "8448802999",
] as const;

export function isQaOtpBypassPhone(phone: string | null | undefined): boolean {
  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return (QA_OTP_BYPASS_PHONES as readonly string[]).includes(national);
}
