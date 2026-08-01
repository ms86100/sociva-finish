// @ts-nocheck
/**
 * Format a price with the configured currency symbol and locale.
 * Usage: formatPrice(199, '₹', 'en-IN') → '₹199'
 */
export function formatPrice(amount: number | string, currencySymbol: string = '₹', locale: string = 'en-IN'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return `${currencySymbol}0`;
  return `${currencySymbol}${num.toLocaleString(locale)}`;
}
