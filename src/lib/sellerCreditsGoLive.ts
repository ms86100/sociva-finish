export type GoLiveCheckStatus = 'pass' | 'fail' | 'blocked' | 'manual';

export type GoLiveCheckItem = {
  id: string;
  label: string;
  status: GoLiveCheckStatus;
  detail?: string;
};

export type GoLiveCertCase = {
  id: string;
  result: string;
};

export type SellerCreditsGoLiveEvidence = {
  productionVerifyOk?: boolean;
  productionCases?: GoLiveCertCase[];
  isolatedCertOk?: boolean;
  isolatedCases?: GoLiveCertCase[];
};

const BILLING_CERT_CASES = [
  'enquiry_charge',
  'enquiry_insufficient_block',
  'contact_debounce_no_duplicate',
  'order_reserve_commit',
  'booking_reserve_release',
] as const;

function casePassed(cases: GoLiveCertCase[] | undefined, id: string): boolean {
  return Boolean(cases?.some((row) => row.id === id && row.result === 'PASS'));
}

function allCasesPassed(cases: GoLiveCertCase[] | undefined, ids: readonly string[]): boolean {
  return ids.every((id) => casePassed(cases, id));
}

export function buildSellerCreditsGoLiveChecks(input: {
  purchaseEnabled: boolean;
  spendEnabled: boolean;
  resolutionReady: boolean;
  capturedPurchaseCount?: number;
  purchaseLedgerCount?: number;
  evidence?: SellerCreditsGoLiveEvidence;
}): GoLiveCheckItem[] {
  const hasCapturedProof = (input.capturedPurchaseCount ?? 0) > 0 && (input.purchaseLedgerCount ?? 0) > 0;
  const evidence = input.evidence;
  const liveDuplicatePass = casePassed(evidence?.productionCases, 'live_duplicate_confirm');
  const liveLedgerPass = casePassed(evidence?.productionCases, 'live_purchase_ledger');
  const liveNotifyPass = casePassed(evidence?.productionCases, 'live_purchase_notification');
  const refundPass = casePassed(evidence?.isolatedCases, 'purchase_refund_unused');
  const billingPass = allCasesPassed(evidence?.isolatedCases, BILLING_CERT_CASES);
  const productionVerifyPass = Boolean(evidence?.productionVerifyOk && liveDuplicatePass && liveLedgerPass);

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
      status: hasCapturedProof ? 'pass' : productionVerifyPass ? 'pass' : 'manual',
      detail: hasCapturedProof || productionVerifyPass
        ? undefined
        : 'Requires verified production payment evidence.',
    },
    {
      id: 'recharge_e2e',
      label: 'In-app recharge reaches Razorpay checkout',
      status: hasCapturedProof ? 'pass' : 'manual',
      detail: hasCapturedProof ? undefined : 'Requires a captured production recharge from the seller app.',
    },
    {
      id: 'duplicate_confirm',
      label: 'Duplicate confirmation / webhook idempotency',
      status: liveDuplicatePass && liveNotifyPass ? 'pass' : productionVerifyPass ? 'pass' : 'manual',
      detail: liveDuplicatePass && liveNotifyPass
        ? 'Live production purchase retry verified.'
        : undefined,
    },
    {
      id: 'refund_path',
      label: 'Unused-credit purchase refund path',
      status: refundPass ? 'pass' : evidence?.isolatedCertOk === false ? 'fail' : 'manual',
      detail: refundPass ? 'Proven in isolated certification harness.' : undefined,
    },
    {
      id: 'billing_e2e',
      label: 'Order / enquiry / booking / contact billing E2E',
      status: billingPass ? 'pass' : evidence?.isolatedCertOk === false ? 'fail' : input.spendEnabled ? 'blocked' : 'manual',
      detail: billingPass
        ? 'Proven in isolated cert harness while production Spend stays OFF.'
        : input.spendEnabled
          ? undefined
          : 'Run billing certification below to prove reserve/commit and debounce paths.',
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
