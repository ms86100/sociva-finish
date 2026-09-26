/** Short codes for marketplace analytics. Never send free text, names, or phone numbers. */

export function contactFailureCode(message: string | null | undefined): string {
  const text = String(message || '');
  if (/SELLER_CREDIT_INSUFFICIENT|isn.?t accepting|not accepting|credit/i.test(text)) {
    return 'credit_blocked';
  }
  if (/duplicate|unique|idempotency|already exists/i.test(text)) {
    return 'duplicate_contact';
  }
  return 'contact_failed';
}
