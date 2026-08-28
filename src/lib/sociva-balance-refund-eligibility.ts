export type SocivaBalanceRefundReason =
  | 'ONLINE_PAYMENT_SUPPORTED'
  | 'PLATFORM_ONLINE_DISABLED'
  | 'WALLET_REFUND_FLAG_DISABLED'
  | 'COD_PAYMENT_NOT_SUPPORTED_FOR_SOCIVA_BALANCE_REFUND'
  | 'ORDER_NOT_FOUND';

export interface SocivaBalanceRefundEligibility {
  eligible: boolean;
  reason: SocivaBalanceRefundReason | string;
  message: string;
  payment_gateway_mode?: string;
  payment_method?: string | null;
  online_platform_enabled?: boolean;
  wallet_refund_credit_enabled?: boolean;
  refund_destination?: string | null;
}

export function normalizeSocivaBalanceRefundEligibility(
  raw: unknown,
): SocivaBalanceRefundEligibility | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  return {
    eligible: data.eligible === true,
    reason: String(data.reason || ''),
    message: String(data.message || ''),
    payment_gateway_mode: data.payment_gateway_mode ? String(data.payment_gateway_mode) : undefined,
    payment_method: data.payment_method != null ? String(data.payment_method) : null,
    online_platform_enabled: data.online_platform_enabled === true,
    wallet_refund_credit_enabled: data.wallet_refund_credit_enabled === true,
    refund_destination: data.refund_destination != null ? String(data.refund_destination) : null,
  };
}

export function buyerDisputeCopy(eligible: boolean): {
  title: string;
  body: string;
} {
  if (eligible) {
    return {
      title: 'Sociva Balance if approved',
      body: 'If the seller approves, your refund is added instantly as Sociva Balance for eligible online purchases on Sociva (not withdrawable to bank).',
    };
  }
  return {
    title: 'Seller dispute',
    body: 'Your seller will review this complaint. Online Sociva Balance refunds are not available for this order — use chat if you need to resolve it with the seller.',
  };
}

export function sellerRefundUnavailableCopy(eligibility: SocivaBalanceRefundEligibility | null): string {
  if (!eligibility) {
    return 'Online payment refunds are currently unavailable. Please contact the buyer through chat or call to resolve the issue.';
  }
  if (eligibility.reason === 'PLATFORM_ONLINE_DISABLED') {
    return 'Online payment refunds are currently unavailable. Please contact the buyer through chat or call to resolve the issue.';
  }
  if (eligibility.reason === 'COD_PAYMENT_NOT_SUPPORTED_FOR_SOCIVA_BALANCE_REFUND') {
    return 'This was a Cash on Delivery order. Sociva Balance refunds are not available — please resolve directly with the buyer via chat or call.';
  }
  return eligibility.message || 'Sociva Balance refund is not available for this order.';
}
