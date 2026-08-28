/**
 * Admin financial controls — labels, grouping, and display helpers.
 * Values are changed only through maker-checker RPCs (never direct table writes).
 */

export type FinancialControlType = 'feature_flag' | 'configuration';

export type FinancialControlRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface FinancialFeatureFlagRow {
  key: string;
  enabled: boolean;
  description: string;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface FinancialConfigurationRow {
  key: string;
  value: string;
  description: string;
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface FinancialControlChangeRequest {
  id: string;
  control_type: FinancialControlType;
  control_key: string;
  old_value: string | null;
  new_value: string;
  reason: string;
  status: FinancialControlRequestStatus;
  requested_by: string;
  approved_by?: string | null;
  requested_at: string;
  decided_at?: string | null;
  expires_at?: string | null;
  requester_name?: string | null;
  approver_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface FinancialAdjustmentRequest {
  id: string;
  reference_type: string;
  reference_id: string;
  entries: unknown;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'posted';
  requested_by: string;
  approved_by?: string | null;
  requested_at: string;
  decided_at?: string | null;
  journal_transaction_id?: string | null;
  requester_name?: string | null;
  approver_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface FinancialControlsSnapshot {
  feature_flags: FinancialFeatureFlagRow[];
  configurations: FinancialConfigurationRow[];
  pending_requests: FinancialControlChangeRequest[];
  recent_requests: FinancialControlChangeRequest[];
  pending_adjustments?: FinancialAdjustmentRequest[];
  recent_adjustments?: FinancialAdjustmentRequest[];
  platform_admin_count?: number;
  pending_control_count?: number;
  pending_adjustment_count?: number;
  pending_total_count?: number;
  preflight: Record<string, unknown>;
  generated_at?: string;
}

export type ControlRisk = 'critical' | 'high' | 'standard';

export const FLAG_RISK: Record<string, ControlRisk> = {
  seller_payout_enabled: 'critical',
  razorpay_route_order_transfer_enabled: 'critical',
  ledger_read_projection: 'critical',
  wallet_spend_enabled: 'critical',
  wallet_issue_enabled: 'high',
  wallet_refund_credit_enabled: 'high',
  buyer_withdrawal_enabled: 'critical',
  buyer_topup_enabled: 'high',
  buyer_p2p_enabled: 'high',
  buyer_loyalty_redeem_enabled: 'standard',
  cod_payable_offset_enabled: 'high',
  provider_payment_create_enabled: 'high',
  provider_payment_confirm_enabled: 'high',
  provider_webhook_capture_enabled: 'high',
  provider_webhook_refund_enabled: 'high',
  provider_refund_processing_enabled: 'high',
  financial_recovery_mutations_enabled: 'standard',
  reconciliation_read_enabled: 'standard',
  ledger_shadow_write: 'standard',
};

export const FLAG_GROUP_ORDER = [
  'Seller payouts & wallet',
  'Payments & refunds',
  'Buyer wallet',
  'Ledger & reconciliation',
  'Other',
] as const;

export const FLAG_GROUP: Record<string, (typeof FLAG_GROUP_ORDER)[number]> = {
  seller_payout_enabled: 'Seller payouts & wallet',
  razorpay_route_order_transfer_enabled: 'Seller payouts & wallet',
  wallet_spend_enabled: 'Seller payouts & wallet',
  wallet_issue_enabled: 'Seller payouts & wallet',
  wallet_refund_credit_enabled: 'Seller payouts & wallet',
  cod_payable_offset_enabled: 'Seller payouts & wallet',
  provider_payment_create_enabled: 'Payments & refunds',
  provider_payment_confirm_enabled: 'Payments & refunds',
  provider_webhook_capture_enabled: 'Payments & refunds',
  provider_webhook_refund_enabled: 'Payments & refunds',
  provider_refund_processing_enabled: 'Payments & refunds',
  buyer_withdrawal_enabled: 'Buyer wallet',
  buyer_topup_enabled: 'Buyer wallet',
  buyer_p2p_enabled: 'Buyer wallet',
  buyer_credit_enabled: 'Buyer wallet',
  buyer_loyalty_redeem_enabled: 'Buyer wallet',
  ledger_shadow_write: 'Ledger & reconciliation',
  ledger_read_projection: 'Ledger & reconciliation',
  reconciliation_read_enabled: 'Ledger & reconciliation',
  financial_recovery_mutations_enabled: 'Ledger & reconciliation',
};

export const CONFIG_OPTIONS: Record<string, { label: string; values: { value: string; label: string }[] }> = {
  provider_payout_mode: {
    label: 'Payout provider mode',
    values: [
      { value: 'disabled', label: 'Disabled — no automated bank payouts' },
      { value: 'razorpay_route_deferred', label: 'Razorpay Route (deferred settlement)' },
    ],
  },
};

export function flagGroup(key: string): string {
  return FLAG_GROUP[key] || 'Other';
}

export function flagRisk(key: string): ControlRisk {
  return FLAG_RISK[key] || 'standard';
}

export function riskBadgeClass(risk: ControlRisk): string {
  if (risk === 'critical') return 'bg-destructive/10 text-destructive border-destructive/20';
  if (risk === 'high') return 'bg-warning/10 text-warning border-warning/20';
  return 'bg-muted text-muted-foreground border-border';
}

export function formatControlValue(
  controlType: FinancialControlType,
  value: string | null | undefined,
): string {
  if (value == null || value === '') return '—';
  if (controlType === 'feature_flag') {
    return value === 'true' || value === 't' ? 'ON' : value === 'false' || value === 'f' ? 'OFF' : value;
  }
  const cfg = Object.values(CONFIG_OPTIONS).flatMap((c) => c.values).find((v) => v.value === value);
  return cfg?.label || value;
}

export function pendingRequestFor(
  requests: FinancialControlChangeRequest[],
  controlType: FinancialControlType,
  controlKey: string,
): FinancialControlChangeRequest | undefined {
  return requests.find(
    (r) => r.status === 'pending' && r.control_type === controlType && r.control_key === controlKey,
  );
}

export function rejectionReason(metadata?: Record<string, unknown> | null): string | null {
  const value = metadata?.rejection_reason;
  return typeof value === 'string' && value.trim() ? value : null;
}

export type PayoutStep = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  pending: boolean;
  request?: { controlType: FinancialControlType; key: string; value: string };
};

export function buildPayoutEnablementSteps(snapshot: FinancialControlsSnapshot): PayoutStep[] {
  const flags = snapshot.feature_flags || [];
  const configs = snapshot.configurations || [];
  const pending = snapshot.pending_requests || [];

  const mode = configs.find((c) => c.key === 'provider_payout_mode')?.value || 'disabled';
  const routeOn = flags.find((f) => f.key === 'razorpay_route_order_transfer_enabled')?.enabled === true;
  const payoutOn = flags.find((f) => f.key === 'seller_payout_enabled')?.enabled === true;

  const pendingMode = pendingRequestFor(pending, 'configuration', 'provider_payout_mode');
  const pendingRoute = pendingRequestFor(pending, 'feature_flag', 'razorpay_route_order_transfer_enabled');
  const pendingPayout = pendingRequestFor(pending, 'feature_flag', 'seller_payout_enabled');

  return [
    {
      id: 'provider_payout_mode',
      label: 'Set payout provider mode',
      detail: 'Switch provider_payout_mode to Razorpay Route (deferred settlement).',
      done: mode === 'razorpay_route_deferred',
      pending: Boolean(pendingMode),
      request: mode !== 'razorpay_route_deferred'
        ? { controlType: 'configuration', key: 'provider_payout_mode', value: 'razorpay_route_deferred' }
        : undefined,
    },
    {
      id: 'razorpay_route_order_transfer_enabled',
      label: 'Enable Route order transfers',
      detail: 'Turn on razorpay_route_order_transfer_enabled so captured orders can settle to sellers.',
      done: routeOn,
      pending: Boolean(pendingRoute),
      request: !routeOn
        ? { controlType: 'feature_flag', key: 'razorpay_route_order_transfer_enabled', value: 'true' }
        : undefined,
    },
    {
      id: 'seller_payout_enabled',
      label: 'Enable seller payouts',
      detail: 'Turn on seller_payout_enabled so sellers can request bank withdrawals.',
      done: payoutOn,
      pending: Boolean(pendingPayout),
      request: !payoutOn
        ? { controlType: 'feature_flag', key: 'seller_payout_enabled', value: 'true' }
        : undefined,
    },
  ];
}
