/** App Store review / integration demo phones only — no SMS; OTP is always 1234. */
export const QA_OTP_BYPASS_PHONES = [
  '0123456789',
  '0987654321',
  '9876543201',
  // TEMP E2E ONLY — remove after seller-dashboard session (no production UI copy)
  '9535115316',
] as const;

export const QA_OTP_CODE = '1234';
export const QA_OTP_REQ_ID = 'apple-review-bypass';

export function isQaOtpBypassPhone(phone: string | null | undefined): boolean {
  const digits = String(phone || '').replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return (QA_OTP_BYPASS_PHONES as readonly string[]).includes(national);
}
