/**
 * Buyer-facing Sociva Balance card visibility rules.
 * - Online payments ON → full card (balance + history)
 * - Online payments OFF + balance > 0 → read-only saved balance message
 * - Online payments OFF + balance = 0 → hidden
 */

export type WalletCardMode = 'hidden' | 'readonly' | 'active';

export function resolveWalletCardMode(params: {
  balance: number;
  onlinePaymentEnabled: boolean;
}): WalletCardMode {
  const balance = Math.max(0, Number(params.balance) || 0);
  if (!params.onlinePaymentEnabled) {
    return balance > 0 ? 'readonly' : 'hidden';
  }
  return 'active';
}
