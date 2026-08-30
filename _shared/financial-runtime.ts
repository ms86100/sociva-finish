export type FinancialCapability =
  | 'payment_ready'
  | 'payout_ready'
  | 'refund_ready'
  | 'reconciliation_ready'
  | 'recovery_ready';

export type FinancialEnablement =
  | 'payment_create_enabled'
  | 'payment_confirm_enabled'
  | 'webhook_capture_enabled'
  | 'webhook_refund_enabled'
  | 'refund_processing_enabled'
  | 'payout_processing_enabled'
  | 'route_transfer_enabled'
  | 'recovery_mutations_enabled'
  | 'reconciliation_read_enabled';

export type FinancialRuntimeCheck = {
  ready: boolean;
  reason?: string;
  state?: Record<string, unknown>;
};

export async function checkFinancialRuntime(
  supabase: any,
  capability: FinancialCapability,
  enablement?: FinancialEnablement | FinancialEnablement[],
): Promise<FinancialRuntimeCheck> {
  const { data, error } = await supabase.rpc('financial_runtime_preflight');
  if (error) {
    return {
      ready: false,
      reason: 'financial_runtime_preflight_unavailable',
      state: { database_error: error.message || String(error) },
    };
  }

  const state = (data && typeof data === 'object' ? data : {}) as Record<
    string,
    unknown
  >;
  if (state[capability] !== true) {
    return {
      ready: false,
      reason: `financial_runtime_${capability}_unavailable`,
      state,
    };
  }
  const requiredEnablements = enablement
    ? Array.isArray(enablement) ? enablement : [enablement]
    : [];
  for (const requiredEnablement of requiredEnablements) {
    if (state[requiredEnablement] !== true) {
      return {
        ready: false,
        reason: `financial_runtime_${requiredEnablement}_disabled`,
        state,
      };
    }
  }
  return { ready: true, state };
}

export function financialRuntimeUnavailableResponse(
  check: FinancialRuntimeCheck,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: check.reason || 'financial_runtime_unavailable',
      retryable: true,
    }),
    {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
}
