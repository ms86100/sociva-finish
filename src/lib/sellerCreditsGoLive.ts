export type GoLiveCheckStatus = 'pass' | 'fail' | 'blocked' | 'manual';

export type GoLiveCheckItem = {
  id: string;
  label: string;
  status: GoLiveCheckStatus;
  detail?: string;
};

export function buildSellerCreditsGoLiveChecks(input: {
  purchaseEnabled: boolean;
  spendEnabled: boolean;
  resolutionReady: boolean;
  capturedPurchaseCount?: number;
  purchaseLedgerCount?: number;
}): GoLiveCheckItem[] {
  const hasCapturedProof = (input.capturedPurchaseCount ?? 0) > 0 && (input.purchaseLedgerCount ?? 0) > 0;

  return [
    {
      id: 'purchase_flag',
      label: 'Purchase flag enabled',
      status: input.purchaseEnabled ? 'pass' : 'fail',
    },
    {
      id: 'spend_off',
      label: 'Spend flag remains OFF until signed off',
      status: input.spendEnabled ? 'fail' : 'pass',
      detail: input.spendEnabled ? 'Spend is ON — turn OFF for safe production.' : undefined,
    },
    {
      id: 'resolution_ready',
      label: 'Booking resolution config complete',
      status: input.resolutionReady ? 'pass' : 'fail',
    },
    {
      id: 'captured_purchase',
      label: 'Live captured purchase with ledger + balance',
      status: hasCapturedProof ? 'pass' : 'manual',
      detail: hasCapturedProof ? undefined : 'Requires verified production payment evidence.',
    },
    {
      id: 'duplicate_confirm',
      label: 'Duplicate confirmation / webhook idempotency',
      status: 'manual',
    },
    {
      id: 'refund_path',
      label: 'Unused-credit purchase refund path',
      status: 'manual',
    },
    {
      id: 'billing_e2e',
      label: 'Order / enquiry / booking / contact billing E2E',
      status: 'blocked',
      detail: 'Blocked while Spend is OFF.',
    },
    {
      id: 'seller_copy',
      label: 'Seller UI reflects Spend-off copy',
      status: 'pass',
    },
  ];
}

export function goLiveChecksAllowSpend(checks: GoLiveCheckItem[]): boolean {
  return checks.every((item) => item.status === 'pass');
}
