/**
 * Seller financial read-model — one mapping of get_seller_financial_summary.
 * Settled GMV stays on get_seller_dashboard_kpis. Never mix the two.
 */

export interface SellerFinancialSummary {
  pending: number;
  available: number;
  reserved: number;
  onHold: number;
  paidOut: number;
  legacySettledUnverified: number;
  refunded: number;
  codExpected: number;
  codCollected: number;
  totalEarned: number;
  withdrawable: number;
}

export function emptySellerFinancialSummary(): SellerFinancialSummary {
  return {
    pending: 0,
    available: 0,
    reserved: 0,
    onHold: 0,
    paidOut: 0,
    legacySettledUnverified: 0,
    refunded: 0,
    codExpected: 0,
    codCollected: 0,
    totalEarned: 0,
    withdrawable: 0,
  };
}

export function mapSellerFinancialSummary(raw: Record<string, unknown> | null | undefined): SellerFinancialSummary {
  const n = (key: string) => Number(raw?.[key] ?? 0) || 0;
  const pending = n('pending');
  const available = n('available');
  const reserved = n('reserved');
  const onHold = n('on_hold');
  const paidOut = n('paid_out');
  const legacySettledUnverified = n('legacy_settled_unverified');
  const refunded = n('refunded');
  const codExpected = n('cod_expected');
  const codCollected = n('cod_collected');
  const totalEarned = pending + available + reserved + onHold + paidOut + legacySettledUnverified;
  return {
    pending,
    available,
    reserved,
    onHold,
    paidOut,
    legacySettledUnverified,
    refunded,
    codExpected,
    codCollected,
    totalEarned,
    withdrawable: available,
  };
}

/** COD cash is never withdrawable — seller already collected it. */
export function isWithdrawableSource(meta?: { not_withdrawable?: boolean; collector_type?: string } | null): boolean {
  if (!meta) return true;
  if (meta.not_withdrawable === true) return false;
  if (meta.collector_type === 'seller') return false;
  return true;
}

/** Partial refund reduces payable by the refunded amount only. */
export function remainingPayableAfterRefund(netAmount: number, refundAmount: number): number {
  return Math.max(roundMoney(netAmount) - roundMoney(refundAmount), 0);
}

export function isFullOrderRefund(orderTotal: number, cumulativeRefunded: number): boolean {
  return roundMoney(cumulativeRefunded) >= roundMoney(orderTotal) && roundMoney(orderTotal) > 0;
}

export function orderPaymentStatusAfterRefund(
  currentStatus: string,
  orderTotal: number,
  cumulativeRefunded: number,
): string {
  return isFullOrderRefund(orderTotal, cumulativeRefunded) ? 'refunded' : currentStatus === 'refunded' ? 'paid' : currentStatus;
}

export function paidOutRequiresTransferRef(settlementStatus: string, transferRef?: string | null): boolean {
  if (settlementStatus !== 'settled') return false;
  return Boolean(transferRef && String(transferRef).trim());
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function activityLabel(type: string, status?: string | null): string {
  if (type === 'refund') return 'Refund issued';
  if (type === 'cod') return 'COD collected (not withdrawable)';
  if (type === 'withdrawal') return 'Withdrawal';
  if (status === 'settled') return 'Paid out';
  if (status === 'eligible') return 'Available for withdrawal';
  if (status === 'pending') return 'Order completed — holding';
  if (status === 'processing') return 'Withdrawal processing';
  if (status === 'on_hold' || status === 'disputed') return 'On hold';
  return 'Settlement update';
}
