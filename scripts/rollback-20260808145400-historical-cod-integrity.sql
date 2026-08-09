-- Reviewed rollback for migration 20260808145400.
-- This script refuses to proceed if a transformed row changed after migration.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.financial_feature_flags
    WHERE enabled
      AND key IN (
        'seller_payout_enabled',
        'razorpay_route_order_transfer_enabled',
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
  ) THEN
    RAISE EXCEPTION 'rollback refused: a financial mutation gate is enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.historical_cod_migration_evidence e
    JOIN public.cod_transactions c ON c.order_id = e.entity_id
    WHERE e.migration_version = '20260808145400'
      AND e.entity_type = 'cod_transaction'
      AND e.action = 'insert_control'
      AND to_jsonb(c) IS DISTINCT FROM e.after_state
  ) THEN
    RAISE EXCEPTION 'rollback refused: a COD control changed after migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.historical_cod_migration_evidence e
    JOIN public.seller_settlements s ON s.id = e.entity_id
    WHERE e.migration_version = '20260808145400'
      AND e.action = 'hold_cod_settlement'
      AND to_jsonb(s) IS DISTINCT FROM e.after_state
  ) THEN
    RAISE EXCEPTION 'rollback refused: a held COD settlement changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM finance.historical_cod_migration_evidence e
    JOIN public.refund_requests r ON r.id = e.entity_id
    WHERE e.migration_version = '20260808145400'
      AND e.action = 'route_cod_refund_manual'
      AND to_jsonb(r) IS DISTINCT FROM e.after_state
  ) THEN
    RAISE EXCEPTION 'rollback refused: a manual COD refund changed';
  END IF;
END;
$$;

UPDATE public.seller_settlements s
SET status = e.before_state->>'status',
    settlement_status = e.before_state->>'settlement_status',
    eligible_at = (e.before_state->>'eligible_at')::timestamptz,
    hold_reason = e.before_state->>'hold_reason',
    updated_at = (e.before_state->>'updated_at')::timestamptz
FROM finance.historical_cod_migration_evidence e
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'seller_settlement'
  AND e.action = 'hold_cod_settlement'
  AND s.id = e.entity_id;

UPDATE public.refund_requests r
SET status = e.before_state->>'status',
    refund_state = e.before_state->>'refund_state',
    refund_destination = e.before_state->>'refund_destination',
    wallet_credit_amount =
      (e.before_state->>'wallet_credit_amount')::numeric,
    failure_reason = e.before_state->>'failure_reason',
    updated_at = (e.before_state->>'updated_at')::timestamptz
FROM finance.historical_cod_migration_evidence e
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'refund_request'
  AND e.action = 'route_cod_refund_manual'
  AND r.id = e.entity_id;

DELETE FROM public.financial_exception_queue q
USING finance.historical_cod_migration_evidence e
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'financial_exception'
  AND e.action = 'insert_exception'
  AND q.id = e.entity_id
  AND to_jsonb(q) = e.after_state;

ALTER TABLE public.cod_transactions
  DISABLE TRIGGER trg_post_cod_financial_event;

DELETE FROM public.cod_transactions c
USING finance.historical_cod_migration_evidence e
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'cod_transaction'
  AND e.action = 'insert_control'
  AND c.order_id = e.entity_id
  AND to_jsonb(c) = e.after_state;

ALTER TABLE public.cod_transactions
  ENABLE TRIGGER trg_post_cod_financial_event;

DROP TRIGGER IF EXISTS trg_enforce_cod_refund_manual_gate
  ON public.refund_requests;
DROP FUNCTION IF EXISTS finance.enforce_cod_refund_manual_gate();

DELETE FROM finance.historical_cod_migration_evidence
WHERE migration_version = '20260808145400';

COMMIT;
