// @ts-nocheck
import { useCallback } from 'react';
import { useSystemSettings } from '@/hooks/useSystemSettings';

/**
 * Returns a bound `formatPrice` function that uses the configured currency symbol and locale.
 * Usage:
 *   const { formatPrice, currencySymbol } = useCurrency();
 *   formatPrice(199) → '₹199'  (or whatever symbol is configured)
 */
export function useCurrency() {
  const { currencySymbol, locale } = useSystemSettings();

  const formatPrice = useCallback(
    (amount: number | string) => {
      const num = typeof amount === 'string' ? parseFloat(amount) : amount;
      if (isNaN(num)) return `${currencySymbol}0`;
      return `${currencySymbol}${num.toLocaleString(locale)}`;
    },
    [currencySymbol, locale],
  );

  return { formatPrice, currencySymbol };
}
