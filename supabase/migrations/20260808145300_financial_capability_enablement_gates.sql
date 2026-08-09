BEGIN;

INSERT INTO public.financial_feature_flags(key, enabled, description)
VALUES
  (
    'provider_payment_create_enabled',
    false,
    'Allow creating provider payment orders'
  ),
  (
    'provider_payment_confirm_enabled',
    false,
    'Allow confirming captured provider payments'
  ),
  (
    'provider_webhook_capture_enabled',
    false,
    'Allow provider webhooks to mutate payment capture state'
  ),
  (
    'provider_webhook_refund_enabled',
    false,
    'Allow provider webhooks to mutate refund or dispute state'
  ),
  (
    'provider_refund_processing_enabled',
    false,
    'Allow automatic provider refund API calls'
  ),
  (
    'financial_recovery_mutations_enabled',
    false,
    'Allow recovery workers to retry provider or financial mutations'
  ),
  (
    'reconciliation_read_enabled',
    false,
    'Allow read-only provider and bank reconciliation workers'
  )
ON CONFLICT (key) DO UPDATE
SET enabled = false,
    description = EXCLUDED.description,
    updated_at = now(),
    updated_by = NULL;

CREATE OR REPLACE FUNCTION public.financial_runtime_preflight()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_schema_ready boolean;
  v_payment_ready boolean;
  v_payout_ready boolean;
  v_refund_ready boolean;
  v_reconciliation_ready boolean;
  v_controls_present boolean;
  v_money_movement_disabled boolean := true;
  v_payment_create_enabled boolean := false;
  v_payment_confirm_enabled boolean := false;
  v_webhook_capture_enabled boolean := false;
  v_webhook_refund_enabled boolean := false;
  v_refund_processing_enabled boolean := false;
  v_payout_processing_enabled boolean := false;
  v_route_transfer_enabled boolean := false;
  v_recovery_mutations_enabled boolean := false;
  v_reconciliation_read_enabled boolean := false;
BEGIN
  v_schema_ready :=
    to_regnamespace('finance') IS NOT NULL
    AND to_regclass('finance.ledger_transactions') IS NOT NULL
    AND to_regclass('finance.ledger_entries') IS NOT NULL;

  v_payment_ready :=
    v_schema_ready
    AND to_regclass('public.payment_provider_events') IS NOT NULL
    AND to_regclass('public.payment_attempts') IS NOT NULL
    AND to_regclass('public.payment_captures') IS NOT NULL
    AND to_regclass('public.payment_capture_allocations') IS NOT NULL
    AND to_regprocedure(
      'public.register_payment_attempt_event(text,text,text,uuid[],text,bigint,text,text,text,timestamp with time zone,text,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.confirm_captured_payment_group(uuid[],text,text,bigint,text,timestamp with time zone,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.link_razorpay_order_group(uuid[],text,uuid)'
    ) IS NOT NULL;

  v_payout_ready :=
    v_schema_ready
    AND to_regclass('public.payout_attempts') IS NOT NULL
    AND to_regprocedure('public.claim_seller_payout(uuid,text,bigint)') IS NOT NULL
    AND to_regprocedure('public.finalize_seller_payout(uuid,text)') IS NOT NULL
    AND to_regprocedure(
      'public.hold_failed_seller_payout(uuid,boolean,text,text)'
    ) IS NOT NULL;

  v_refund_ready :=
    v_schema_ready
    AND to_regclass('public.refund_attempts') IS NOT NULL
    AND to_regclass('public.refund_allocation_snapshots') IS NOT NULL
    AND to_regprocedure(
      'public.claim_refund_attempt(uuid,text,text,bigint)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.complete_refund_by_gateway_id(text,text,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'public.record_provider_chargeback(text,text,text,bigint,text,jsonb)'
    ) IS NOT NULL;

  v_reconciliation_ready :=
    v_schema_ready
    AND to_regclass('public.financial_reconciliation_records') IS NOT NULL
    AND to_regclass('public.provider_statement_rows') IS NOT NULL
    AND to_regclass('public.bank_statement_rows') IS NOT NULL
    AND to_regprocedure('public.run_financial_reconciliation(date)') IS NOT NULL
    AND to_regprocedure('public.reconcile_external_statements(date)') IS NOT NULL;

  v_controls_present :=
    to_regclass('public.financial_feature_flags') IS NOT NULL
    AND to_regclass('public.financial_configuration') IS NOT NULL;

  IF v_controls_present THEN
    SELECT
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'provider_payment_create_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'provider_payment_confirm_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'provider_webhook_capture_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'provider_webhook_refund_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'provider_refund_processing_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'financial_recovery_mutations_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'reconciliation_read_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'seller_payout_enabled'
      ), false),
      COALESCE(bool_or(enabled) FILTER (
        WHERE key = 'razorpay_route_order_transfer_enabled'
      ), false)
    INTO
      v_payment_create_enabled,
      v_payment_confirm_enabled,
      v_webhook_capture_enabled,
      v_webhook_refund_enabled,
      v_refund_processing_enabled,
      v_recovery_mutations_enabled,
      v_reconciliation_read_enabled,
      v_payout_processing_enabled,
      v_route_transfer_enabled
    FROM public.financial_feature_flags;

    v_payout_processing_enabled :=
      v_payout_processing_enabled
      AND COALESCE((
        SELECT value <> 'disabled'
        FROM public.financial_configuration
        WHERE key = 'provider_payout_mode'
      ), false);

    SELECT NOT EXISTS (
      SELECT 1
      FROM public.financial_feature_flags
      WHERE key IN (
        'seller_payout_enabled',
        'razorpay_route_order_transfer_enabled',
        'buyer_withdrawal_enabled',
        'buyer_topup_enabled',
        'buyer_p2p_enabled',
        'wallet_spend_enabled',
        'wallet_issue_enabled',
        'wallet_refund_credit_enabled',
        'cod_payable_offset_enabled',
        'provider_payment_create_enabled',
        'provider_payment_confirm_enabled',
        'provider_webhook_capture_enabled',
        'provider_webhook_refund_enabled',
        'provider_refund_processing_enabled',
        'financial_recovery_mutations_enabled'
      )
      AND enabled
    )
    INTO v_money_movement_disabled;
  END IF;

  RETURN jsonb_build_object(
    'schema_ready', v_schema_ready,
    'payment_ready', v_payment_ready,
    'payout_ready', v_payout_ready,
    'refund_ready', v_refund_ready,
    'reconciliation_ready', v_reconciliation_ready,
    'recovery_ready',
      v_payment_ready
      AND v_payout_ready
      AND v_refund_ready
      AND v_reconciliation_ready,
    'payment_create_enabled', v_payment_create_enabled,
    'payment_confirm_enabled', v_payment_confirm_enabled,
    'webhook_capture_enabled', v_webhook_capture_enabled,
    'webhook_refund_enabled', v_webhook_refund_enabled,
    'refund_processing_enabled', v_refund_processing_enabled,
    'payout_processing_enabled', v_payout_processing_enabled,
    'route_transfer_enabled', v_route_transfer_enabled,
    'recovery_mutations_enabled', v_recovery_mutations_enabled,
    'reconciliation_read_enabled', v_reconciliation_read_enabled,
    'controls_present', v_controls_present,
    'money_movement_disabled', v_money_movement_disabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.financial_runtime_preflight()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_runtime_preflight()
  TO service_role;

COMMENT ON FUNCTION public.financial_runtime_preflight() IS
  'Reports technical readiness separately from explicit per-capability enablement. All provider mutation gates default false.';

COMMIT;
