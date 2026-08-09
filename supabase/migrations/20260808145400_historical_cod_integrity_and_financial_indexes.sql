BEGIN;

CREATE TABLE IF NOT EXISTS finance.historical_cod_migration_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_version text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  evidence_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (migration_version, entity_type, entity_id, action)
);

ALTER TABLE finance.historical_cod_migration_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE finance.historical_cod_migration_evidence
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE finance.historical_cod_migration_evidence TO service_role;

-- Cover every currently-unindexed financial foreign key. These indexes change
-- no business data and make parent-row updates/deletes predictable.
CREATE INDEX IF NOT EXISTS idx_bank_statement_rows_import_id
  ON public.bank_statement_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_chargeback_allocations_order_id
  ON public.chargeback_allocations(order_id);
CREATE INDEX IF NOT EXISTS idx_chargeback_allocations_seller_id
  ON public.chargeback_allocations(seller_id);
CREATE INDEX IF NOT EXISTS idx_chargeback_cases_order_id
  ON public.chargeback_cases(order_id);
CREATE INDEX IF NOT EXISTS idx_chargeback_cases_seller_id
  ON public.chargeback_cases(seller_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_payment_record_id
  ON finance.ledger_entries(payment_record_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_refund_id
  ON finance.ledger_entries(refund_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_settlement_id
  ON finance.ledger_entries(settlement_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_event_type
  ON finance.ledger_transactions(event_type);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_reversal
  ON finance.ledger_transactions(reverses_transaction_id)
  WHERE reverses_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_capture_allocations_order_id
  ON public.payment_capture_allocations(order_id);
CREATE INDEX IF NOT EXISTS idx_payout_attempts_destination_id
  ON public.payout_attempts(destination_id);
CREATE INDEX IF NOT EXISTS idx_payout_attempts_settlement_id
  ON public.payout_attempts(settlement_id);
CREATE INDEX IF NOT EXISTS idx_provider_statement_rows_import_id
  ON public.provider_statement_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_refund_allocation_snapshots_order_id
  ON public.refund_allocation_snapshots(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_attempts_refund_id
  ON public.refund_attempts(refund_id);
CREATE INDEX IF NOT EXISTS idx_seller_liability_entries_reversal
  ON public.seller_liability_entries(reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_seller_liability_entries_seller_id
  ON public.seller_liability_entries(seller_id);
CREATE INDEX IF NOT EXISTS idx_seller_return_reserves_refund_id
  ON public.seller_return_reserves(refund_id);
CREATE INDEX IF NOT EXISTS idx_seller_return_reserves_seller_id
  ON public.seller_return_reserves(seller_id);

-- Capture the exact rows eligible for an internal COD control backfill. A COD
-- control is created only for a non-cancelled order with both parties present.
-- Paid/confirmed status additionally requires seller confirmation and a
-- timestamp. No provider or bank evidence is inferred.
INSERT INTO finance.historical_cod_migration_evidence (
  migration_version,
  entity_type,
  entity_id,
  action,
  evidence_basis,
  before_state
)
SELECT
  '20260808145400',
  'cod_transaction',
  o.id,
  'insert_control',
  jsonb_build_object(
    'payment_type', o.payment_type,
    'order_status', o.status,
    'payment_status', o.payment_status,
    'payment_confirmed_by_seller', o.payment_confirmed_by_seller,
    'payment_confirmed_at', o.payment_confirmed_at,
    'source', 'orders'
  ),
  NULL
FROM public.orders o
WHERE lower(COALESCE(o.payment_type, '')) = 'cod'
  AND o.status::text <> 'cancelled'
  AND o.buyer_id IS NOT NULL
  AND o.seller_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.cod_transactions c
    WHERE c.order_id = o.id
  )
ON CONFLICT (migration_version, entity_type, entity_id, action) DO NOTHING;

-- This is an evidence/control backfill, not an accounting backfill. Suppress
-- only the canonical COD posting trigger while inserting historical controls
-- so no ledger, payable, provider, or bank facts are fabricated.
ALTER TABLE public.cod_transactions
  DISABLE TRIGGER trg_post_cod_financial_event;

INSERT INTO public.cod_transactions (
  order_id,
  buyer_id,
  seller_id,
  collector_type,
  expected_amount_minor,
  status,
  created_at,
  updated_at
)
SELECT
  o.id,
  o.buyer_id,
  o.seller_id,
  CASE
    WHEN COALESCE(o.delivery_handled_by, '') = 'platform' THEN 'courier'
    ELSE 'seller'
  END,
  round(o.total_amount * 100)::bigint,
  'expected',
  COALESCE(o.created_at, now()),
  now()
FROM public.orders o
JOIN finance.historical_cod_migration_evidence e
  ON e.entity_type = 'cod_transaction'
 AND e.entity_id = o.id
 AND e.action = 'insert_control'
 AND e.migration_version = '20260808145400'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.cod_transactions c
  WHERE c.order_id = o.id
);

UPDATE public.cod_transactions c
SET status = 'confirmed',
    collected_amount_minor = c.expected_amount_minor,
    confirmed_at = o.payment_confirmed_at,
    proof_reference = 'internal:order_seller_confirmation:' || o.id::text,
    updated_at = now()
FROM public.orders o
JOIN finance.historical_cod_migration_evidence e
  ON e.entity_type = 'cod_transaction'
 AND e.entity_id = o.id
 AND e.action = 'insert_control'
 AND e.migration_version = '20260808145400'
WHERE c.order_id = o.id
  AND o.payment_status = 'paid'
  AND o.payment_confirmed_by_seller IS TRUE
  AND o.payment_confirmed_at IS NOT NULL;

ALTER TABLE public.cod_transactions
  ENABLE TRIGGER trg_post_cod_financial_event;

UPDATE finance.historical_cod_migration_evidence e
SET after_state = to_jsonb(c)
FROM public.cod_transactions c
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'cod_transaction'
  AND e.action = 'insert_control'
  AND c.order_id = e.entity_id;

-- Existing COD settlements are not platform-held online tender. Preserve the
-- original row verbatim, then hold it without creating seller payable.
INSERT INTO finance.historical_cod_migration_evidence (
  migration_version,
  entity_type,
  entity_id,
  action,
  evidence_basis,
  before_state
)
SELECT
  '20260808145400',
  'seller_settlement',
  s.id,
  'hold_cod_settlement',
  jsonb_build_object(
    'order_id', o.id,
    'payment_type', o.payment_type,
    'payment_status', o.payment_status,
    'source', 'orders_and_seller_settlements'
  ),
  to_jsonb(s)
FROM public.seller_settlements s
JOIN public.orders o ON o.id = s.order_id
WHERE lower(COALESCE(o.payment_type, '')) = 'cod'
  AND (
    s.settlement_status IS DISTINCT FROM 'held'
    OR s.hold_reason IS DISTINCT FROM 'historical_cod_not_platform_payable'
    OR s.eligible_at IS NOT NULL
  )
ON CONFLICT (migration_version, entity_type, entity_id, action) DO NOTHING;

UPDATE public.seller_settlements s
SET status = 'on_hold',
    settlement_status = 'held',
    eligible_at = NULL,
    hold_reason = 'historical_cod_not_platform_payable',
    updated_at = now()
FROM finance.historical_cod_migration_evidence e
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'seller_settlement'
  AND e.action = 'hold_cod_settlement'
  AND s.id = e.entity_id;

UPDATE finance.historical_cod_migration_evidence e
SET after_state = to_jsonb(s)
FROM public.seller_settlements s
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'seller_settlement'
  AND e.action = 'hold_cod_settlement'
  AND s.id = e.entity_id;

-- Missing historical collection evidence is an exception, never an invented
-- payment record. Separate exception types preserve the exact operational gap.
INSERT INTO public.financial_exception_queue (
  exception_type,
  severity,
  status,
  escalation_due_at,
  last_error,
  metadata
)
SELECT
  'historical_cod_paid_missing_payment_record',
  'critical',
  'open',
  now() + interval '4 hours',
  'COD order is marked paid but has no exact paid COD payment record',
  jsonb_build_object(
    'migration_version', '20260808145400',
    'order_id', o.id,
    'payment_status', o.payment_status,
    'payment_confirmed_at', o.payment_confirmed_at,
    'evidence_source', 'orders'
  )
FROM public.orders o
WHERE lower(COALESCE(o.payment_type, '')) = 'cod'
  AND o.payment_status = 'paid'
  AND NOT EXISTS (
    SELECT 1
    FROM public.payment_records p
    WHERE p.order_id = o.id
      AND lower(p.payment_method) = 'cod'
      AND lower(p.payment_status) = 'paid'
      AND p.amount = o.total_amount
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_exception_queue q
    WHERE q.exception_type = 'historical_cod_paid_missing_payment_record'
      AND q.metadata->>'order_id' = o.id::text
  );

INSERT INTO public.financial_exception_queue (
  exception_type,
  severity,
  status,
  escalation_due_at,
  last_error,
  metadata
)
SELECT
  'historical_cod_settlement_without_platform_capture',
  'critical',
  'open',
  now() + interval '4 hours',
  'COD settlement has no platform-held capture and is held from payout',
  jsonb_build_object(
    'migration_version', '20260808145400',
    'order_id', o.id,
    'settlement_id', s.id,
    'evidence_source', 'orders_and_seller_settlements'
  )
FROM public.seller_settlements s
JOIN public.orders o ON o.id = s.order_id
WHERE lower(COALESCE(o.payment_type, '')) = 'cod'
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_exception_queue q
    WHERE q.exception_type =
      'historical_cod_settlement_without_platform_capture'
      AND q.metadata->>'settlement_id' = s.id::text
  );

-- COD refunds cannot call an original-payment provider path. While wallet
-- refund credit is disabled they remain manual and are explicitly queued.
INSERT INTO finance.historical_cod_migration_evidence (
  migration_version,
  entity_type,
  entity_id,
  action,
  evidence_basis,
  before_state
)
SELECT
  '20260808145400',
  'refund_request',
  r.id,
  'route_cod_refund_manual',
  jsonb_build_object(
    'order_id', o.id,
    'payment_type', o.payment_type,
    'wallet_refund_credit_enabled',
      COALESCE((
        SELECT enabled
        FROM public.financial_feature_flags
        WHERE key = 'wallet_refund_credit_enabled'
      ), false),
    'source', 'orders_and_refund_requests'
  ),
  to_jsonb(r)
FROM public.refund_requests r
JOIN public.orders o ON o.id = r.order_id
WHERE lower(COALESCE(o.payment_type, '')) = 'cod'
  AND NOT COALESCE((
    SELECT enabled
    FROM public.financial_feature_flags
    WHERE key = 'wallet_refund_credit_enabled'
  ), false)
  AND r.refund_state IS DISTINCT FROM 'needs_manual_review'
ON CONFLICT (migration_version, entity_type, entity_id, action) DO NOTHING;

-- The historical state machine did not allow requested -> needs_manual_review.
-- Suppress only that transition trigger for this evidence-backed migration;
-- the new COD manual gate is installed below before commit.
ALTER TABLE public.refund_requests
  DISABLE TRIGGER trg_refund_state_machine;

UPDATE public.refund_requests r
SET refund_state = 'needs_manual_review',
    status = 'requested',
    failure_reason = 'cod_refund_requires_manual_cash_resolution',
    updated_at = now()
FROM finance.historical_cod_migration_evidence e
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'refund_request'
  AND e.action = 'route_cod_refund_manual'
  AND r.id = e.entity_id;

ALTER TABLE public.refund_requests
  ENABLE TRIGGER trg_refund_state_machine;

UPDATE finance.historical_cod_migration_evidence e
SET after_state = to_jsonb(r)
FROM public.refund_requests r
WHERE e.migration_version = '20260808145400'
  AND e.entity_type = 'refund_request'
  AND e.action = 'route_cod_refund_manual'
  AND r.id = e.entity_id;

INSERT INTO public.financial_exception_queue (
  exception_type,
  severity,
  status,
  escalation_due_at,
  last_error,
  metadata
)
SELECT
  'cod_refund_manual_resolution_required',
  'critical',
  'open',
  now() + interval '4 hours',
  'COD refund has no provider original-payment path; manual review required',
  jsonb_build_object(
    'migration_version', '20260808145400',
    'order_id', o.id,
    'refund_id', r.id,
    'evidence_source', 'orders_and_refund_requests'
  )
FROM public.refund_requests r
JOIN public.orders o ON o.id = r.order_id
WHERE lower(COALESCE(o.payment_type, '')) = 'cod'
  AND NOT EXISTS (
    SELECT 1
    FROM public.financial_exception_queue q
    WHERE q.exception_type = 'cod_refund_manual_resolution_required'
      AND q.metadata->>'refund_id' = r.id::text
  );

INSERT INTO finance.historical_cod_migration_evidence (
  migration_version,
  entity_type,
  entity_id,
  action,
  evidence_basis,
  after_state
)
SELECT
  '20260808145400',
  'financial_exception',
  q.id,
  'insert_exception',
  q.metadata,
  to_jsonb(q)
FROM public.financial_exception_queue q
WHERE q.metadata->>'migration_version' = '20260808145400'
ON CONFLICT (migration_version, entity_type, entity_id, action) DO NOTHING;

CREATE OR REPLACE FUNCTION finance.enforce_cod_refund_manual_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_catalog, pg_temp
AS $$
DECLARE
  v_is_cod boolean;
  v_wallet_refund_enabled boolean;
BEGIN
  SELECT lower(COALESCE(o.payment_type, '')) = 'cod'
  INTO v_is_cod
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  IF NOT COALESCE(v_is_cod, false) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(enabled, false)
  INTO v_wallet_refund_enabled
  FROM public.financial_feature_flags
  WHERE key = 'wallet_refund_credit_enabled';

  IF NOT COALESCE(v_wallet_refund_enabled, false)
     AND NEW.refund_state IN (
       'approved',
       'refund_initiated',
       'refund_processing',
       'refund_completed'
     )
     AND NEW.refund_state IS DISTINCT FROM OLD.refund_state THEN
    RAISE EXCEPTION
      'COD refund requires manual resolution while wallet refund credit is disabled';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION finance.enforce_cod_refund_manual_gate()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.enforce_cod_refund_manual_gate()
  TO service_role;

DROP TRIGGER IF EXISTS trg_enforce_cod_refund_manual_gate
  ON public.refund_requests;
CREATE TRIGGER trg_enforce_cod_refund_manual_gate
BEFORE UPDATE OF refund_state, refund_destination, wallet_credit_amount
ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION finance.enforce_cod_refund_manual_gate();

COMMIT;
