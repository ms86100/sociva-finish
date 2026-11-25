/** App Store review / integration demo phones only - no SMS; OTP is always 1234. */
export const QA_OTP_BYPASS_PHONES = [
  '0123456789',
  '0987654321',
  '9876543201',
  '9535115316',
  '8448802907',
  // Staging join E2E - approved registry / pending membership / no maps
  '8448802999',
  // Staging first-login + join UI (non-member)
  '8448802888',
] as const;

export const QA_OTP_CODE = '1234';
export const QA_OTP_REQ_ID = 'apple-review-bypass';

export function isQaOtpBypassPhone(phone: string | null | undefined): boolean {
  const digits = String(phone || '').replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return (QA_OTP_BYPASS_PHONES as readonly string[]).includes(national);
}
