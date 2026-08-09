-- SOCIVA financial hardening
-- Conservative product mode:
--   * platform collect + deferred seller settlement
--   * SOCIVA Credit is non-loadable/non-transferable/non-withdrawable
--   * seller-collected COD is not an online payout balance

BEGIN;

CREATE SCHEMA IF NOT EXISTS finance;
REVOKE ALL ON SCHEMA finance FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA finance TO service_role;

-- One provider capture can fund several child orders. Provider identity is
-- unique on the capture, not on each child payment snapshot.
DROP INDEX IF EXISTS public.idx_payment_records_razorpay_payment_id;
DROP INDEX IF EXISTS public.unique_razorpay_payment_id;
CREATE INDEX IF NOT EXISTS idx_payment_records_razorpay_payment_id_lookup
  ON public.payment_records (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_records_provider_payment_order
  ON public.payment_records (razorpay_payment_id, order_id)
  WHERE razorpay_payment_id IS NOT NULL;

-- Wrap the existing atomic confirmation RPC so a different capture can never
-- be accepted as an idempotent retry for an already-paid order.
ALTER FUNCTION public.confirm_orders_after_razorpay_payment(uuid[], text, text, text)
  RENAME TO confirm_orders_after_razorpay_payment_impl;
REVOKE ALL ON FUNCTION public.confirm_orders_after_razorpay_payment_impl(
  uuid[], text, text, text
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.confirm_orders_after_razorpay_payment(
  p_order_ids uuid[],
  p_razorpay_payment_id text,
  p_razorpay_order_id text DEFAULT NULL,
  p_source text DEFAULT 'edge_confirm'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order record;
BEGIN
  FOR v_order IN
    SELECT
      o.id,
      o.payment_status,
      COALESCE(o.razorpay_payment_id, pr.razorpay_payment_id) AS existing_payment_id
    FROM public.orders o
    LEFT JOIN public.payment_records pr ON pr.order_id = o.id
    WHERE o.id = ANY(p_order_ids)
    ORDER BY o.id
    FOR UPDATE OF o
  LOOP
    IF v_order.payment_status = 'paid'
       AND v_order.existing_payment_id IS DISTINCT FROM p_razorpay_payment_id THEN
      RAISE EXCEPTION
        'duplicate_capture: order % already paid by %, incoming %',
        v_order.id,
        COALESCE(v_order.existing_payment_id, 'unknown'),
        p_razorpay_payment_id;
    END IF;
  END LOOP;

  RETURN public.confirm_orders_after_razorpay_payment_impl(
    p_order_ids,
    p_razorpay_payment_id,
    p_razorpay_order_id,
    p_source
  );
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_orders_after_razorpay_payment(
  uuid[], text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_orders_after_razorpay_payment(
  uuid[], text, text, text
) TO service_role;

CREATE TABLE IF NOT EXISTS finance.ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  account_type text NOT NULL CHECK (
    account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'clearing')
  ),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  owner_type text,
  owner_id uuid,
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = upper(currency)),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (owner_type, owner_id, code, currency)
);

CREATE TABLE IF NOT EXISTS finance.journal_templates (
  event_type text PRIMARY KEY,
  description text NOT NULL,
  required_account_codes text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL REFERENCES finance.journal_templates(event_type),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload_fingerprint text NOT NULL,
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = upper(currency)),
  effective_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  reverses_transaction_id uuid REFERENCES finance.ledger_transactions(id),
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'REVERSAL' AND reverses_transaction_id IS NOT NULL)
    OR (event_type <> 'REVERSAL' AND reverses_transaction_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS finance.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES finance.ledger_transactions(id),
  account_id uuid NOT NULL REFERENCES finance.ledger_accounts(id),
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = upper(currency)),
  order_id uuid REFERENCES public.orders(id),
  payment_record_id uuid REFERENCES public.payment_records(id),
  refund_id uuid REFERENCES public.refund_requests(id),
  settlement_id uuid REFERENCES public.seller_settlements(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_entries_transaction
  ON finance.ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_finance_entries_account_created
  ON finance.ledger_entries(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_entries_order
  ON finance.ledger_entries(order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION finance.guard_posted_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_transaction_id uuid;
BEGIN
  v_transaction_id := CASE
    WHEN TG_OP = 'INSERT' THEN NEW.transaction_id
    ELSE OLD.transaction_id
  END;
  IF EXISTS (
    SELECT 1
    FROM finance.ledger_transactions t
    WHERE t.id = v_transaction_id
      AND t.posted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'posted financial journals are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_posted_ledger_entry ON finance.ledger_entries;
CREATE TRIGGER trg_guard_posted_ledger_entry
BEFORE INSERT OR UPDATE OR DELETE ON finance.ledger_entries
FOR EACH ROW EXECUTE FUNCTION finance.guard_posted_journal_mutation();

CREATE OR REPLACE FUNCTION finance.guard_posted_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, pg_temp
AS $$
BEGIN
  IF OLD.posted_at IS NOT NULL THEN
    RAISE EXCEPTION 'posted financial journals are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_posted_ledger_transaction
  ON finance.ledger_transactions;
CREATE TRIGGER trg_guard_posted_ledger_transaction
BEFORE UPDATE OR DELETE ON finance.ledger_transactions
FOR EACH ROW EXECUTE FUNCTION finance.guard_posted_transaction_mutation();

CREATE OR REPLACE FUNCTION finance.post_journal(
  p_event_type text,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text,
  p_entries jsonb,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_effective_at timestamptz DEFAULT NULL,
  p_reverses_transaction_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_transaction_id uuid;
  v_entry jsonb;
  v_account finance.ledger_accounts%ROWTYPE;
  v_debits bigint := 0;
  v_credits bigint := 0;
  v_count integer := 0;
  v_currency text := 'INR';
  v_required_accounts text[];
  v_used_accounts text[] := ARRAY[]::text[];
  v_payload jsonb;
  v_fingerprint text;
  v_existing_fingerprint text;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;

  v_payload := jsonb_build_object(
    'event_type', p_event_type,
    'reference_type', p_reference_type,
    'reference_id', p_reference_id,
    'entries', p_entries,
    'description', p_description,
    'metadata', COALESCE(p_metadata, '{}'::jsonb),
    'effective_at', p_effective_at,
    'reverses_transaction_id', p_reverses_transaction_id
  );
  v_fingerprint := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT id, payload_fingerprint
  INTO v_transaction_id, v_existing_fingerprint
  FROM finance.ledger_transactions
  WHERE idempotency_key = p_idempotency_key;
  IF v_transaction_id IS NOT NULL THEN
    IF v_existing_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'idempotency key payload mismatch';
    END IF;
    RETURN v_transaction_id;
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION 'a journal requires at least two entries';
  END IF;

  SELECT required_account_codes
  INTO v_required_accounts
  FROM finance.journal_templates
  WHERE event_type = p_event_type
    AND enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown or disabled journal template: %', p_event_type;
  END IF;

  INSERT INTO finance.ledger_transactions (
    event_type,
    reference_type,
    reference_id,
    idempotency_key,
    payload_fingerprint,
    currency,
    effective_at,
    reverses_transaction_id,
    description,
    metadata,
    created_by
  ) VALUES (
    p_event_type,
    p_reference_type,
    p_reference_id,
    p_idempotency_key,
    v_fingerprint,
    v_currency,
    COALESCE(p_effective_at, now()),
    p_reverses_transaction_id,
    p_description,
    COALESCE(p_metadata, '{}'::jsonb),
    auth.uid()
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_transaction_id;
  IF v_transaction_id IS NULL THEN
    SELECT id, payload_fingerprint
    INTO v_transaction_id, v_existing_fingerprint
    FROM finance.ledger_transactions
    WHERE idempotency_key = p_idempotency_key;
    IF v_existing_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'idempotency key payload mismatch';
    END IF;
    RETURN v_transaction_id;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    SELECT * INTO v_account
    FROM finance.ledger_accounts
    WHERE code = v_entry->>'account_code'
      AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown or inactive ledger account: %', v_entry->>'account_code';
    END IF;
    IF v_account.currency <> v_currency THEN
      RAISE EXCEPTION 'journal currency does not match account currency';
    END IF;
    v_used_accounts := array_append(v_used_accounts, v_account.code);
    IF (v_entry->>'direction') NOT IN ('debit', 'credit') THEN
      RAISE EXCEPTION 'invalid ledger direction';
    END IF;
    IF COALESCE((v_entry->>'amount_minor')::bigint, 0) <= 0 THEN
      RAISE EXCEPTION 'ledger amount must be positive integer minor units';
    END IF;

    INSERT INTO finance.ledger_entries (
      transaction_id,
      account_id,
      direction,
      amount_minor,
      currency,
      order_id,
      payment_record_id,
      refund_id,
      settlement_id,
      metadata
    ) VALUES (
      v_transaction_id,
      v_account.id,
      v_entry->>'direction',
      (v_entry->>'amount_minor')::bigint,
      v_currency,
      NULLIF(v_entry->>'order_id', '')::uuid,
      NULLIF(v_entry->>'payment_record_id', '')::uuid,
      NULLIF(v_entry->>'refund_id', '')::uuid,
      NULLIF(v_entry->>'settlement_id', '')::uuid,
      COALESCE(v_entry->'metadata', '{}'::jsonb)
    );

    v_count := v_count + 1;
    IF v_entry->>'direction' = 'debit' THEN
      v_debits := v_debits + (v_entry->>'amount_minor')::bigint;
    ELSE
      v_credits := v_credits + (v_entry->>'amount_minor')::bigint;
    END IF;
  END LOOP;

  IF v_count < 2 OR v_debits <> v_credits THEN
    RAISE EXCEPTION 'unbalanced journal: debits %, credits %', v_debits, v_credits;
  END IF;
  IF NOT COALESCE(v_required_accounts <@ v_used_accounts, true) THEN
    RAISE EXCEPTION 'journal is missing required template accounts';
  END IF;

  UPDATE finance.ledger_transactions
  SET posted_at = now()
  WHERE id = v_transaction_id;

  RETURN v_transaction_id;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA finance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA finance TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finance TO service_role;
GRANT EXECUTE ON FUNCTION finance.post_journal(
  text, text, text, text, jsonb, text, jsonb, timestamptz, uuid
) TO service_role;

INSERT INTO finance.ledger_accounts (code, name, account_type, normal_balance)
VALUES
  ('gateway_clearing', 'Razorpay gateway clearing', 'asset', 'debit'),
  ('cash_at_bank', 'Platform settlement bank', 'asset', 'debit'),
  ('seller_payable_control', 'Seller payable control', 'liability', 'credit'),
  ('seller_payable_pending', 'Seller payable pending eligibility', 'liability', 'credit'),
  ('seller_payable_available', 'Seller payable available for payout', 'liability', 'credit'),
  ('buyer_credit_liability', 'SOCIVA Credit liability', 'liability', 'credit'),
  ('refund_payable', 'Refund payable', 'liability', 'credit'),
  ('cod_receivable', 'COD receivable and reconciliation', 'asset', 'debit'),
  ('platform_commission_revenue', 'Platform commission revenue', 'revenue', 'credit'),
  ('gateway_fee_expense', 'Payment gateway fee expense', 'expense', 'debit'),
  ('promotion_expense', 'SOCIVA-funded promotion expense', 'expense', 'debit'),
  ('settlement_in_transit', 'Seller payout in transit', 'clearing', 'debit'),
  ('financial_suspense', 'Financial reconciliation suspense', 'clearing', 'debit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO finance.journal_templates (
  event_type, description, required_account_codes
)
VALUES
  ('PAYMENT_CAPTURED', 'Provider payment captured into allocation suspense', ARRAY['gateway_clearing', 'financial_suspense']),
  ('PAYMENT_ALLOCATED', 'Provider capture allocated to a child seller order', ARRAY['financial_suspense', 'seller_payable_pending']),
  ('SELLER_EARNING_ELIGIBLE', 'Seller payable moved from pending to available', ARRAY['seller_payable_pending', 'seller_payable_available']),
  ('PLATFORM_COMMISSION', 'Platform commission recognized under approved policy', ARRAY['seller_payable_pending', 'platform_commission_revenue']),
  ('BUYER_CREDIT_ISSUED', 'Non-withdrawable SOCIVA Credit issued', ARRAY['buyer_credit_liability']),
  ('BUYER_CREDIT_SPENT', 'SOCIVA Credit applied to an order', ARRAY['buyer_credit_liability']),
  ('REFUND_REQUESTED', 'Refund liability recognized', ARRAY['refund_payable']),
  ('REFUND_PROCESSED', 'Provider refund confirmed', ARRAY['gateway_clearing', 'refund_payable']),
  ('COD_EXPECTED', 'COD expected from the configured collector', ARRAY['cod_receivable']),
  ('COD_COLLECTED', 'COD collection confirmed', ARRAY['cod_receivable']),
  ('PAYOUT_RESERVED', 'Seller payout amount reserved', ARRAY['seller_payable_available', 'settlement_in_transit']),
  ('PAYOUT_SUCCEEDED', 'Seller payout confirmed by provider', ARRAY['settlement_in_transit', 'cash_at_bank']),
  ('PAYOUT_FAILED_RELEASED', 'Failed payout reservation released', ARRAY['seller_payable_control', 'settlement_in_transit']),
  ('ADJUSTMENT', 'Approved maker-checker financial adjustment', ARRAY['financial_suspense']),
  ('REVERSAL', 'Exact reversal of a posted journal', ARRAY[]::text[])
ON CONFLICT (event_type) DO UPDATE
SET description = EXCLUDED.description,
    required_account_codes = EXCLUDED.required_account_codes,
    updated_at = now();

-- Durable provider inbox. Payload is operational evidence and is never exposed
-- directly to buyers or sellers.
CREATE TABLE IF NOT EXISTS public.payment_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  signature text,
  processing_status text NOT NULL DEFAULT 'received' CHECK (
    processing_status IN ('received', 'processing', 'processed', 'failed', 'retrying', 'dead_letter')
  ),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  error_message text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  UNIQUE (provider, event_id)
);
ALTER TABLE public.payment_provider_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_provider_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_provider_events TO service_role;
CREATE INDEX IF NOT EXISTS idx_provider_events_work_queue
  ON public.payment_provider_events(processing_status, received_at)
  WHERE processing_status IN ('received', 'failed', 'retrying');

CREATE TABLE IF NOT EXISTS public.payment_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  provider_order_id text,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (
    status IN ('authorized', 'captured', 'refunded', 'partially_refunded', 'unknown', 'reconciliation_required')
  ),
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_payment_id)
);

CREATE TABLE IF NOT EXISTS public.payment_capture_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id uuid NOT NULL REFERENCES public.payment_captures(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  seller_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(capture_id, order_id)
);

ALTER TABLE public.payment_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_capture_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_captures FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.payment_capture_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_captures TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.payment_capture_allocations TO service_role;

CREATE OR REPLACE FUNCTION finance.reject_duplicate_capture_for_paid_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_conflicting_order uuid;
BEGIN
  IF NEW.provider <> 'razorpay' OR NEW.provider_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.id INTO v_conflicting_order
  FROM public.orders o
  WHERE o.razorpay_order_id = NEW.provider_order_id
    AND o.payment_status = 'paid'
    AND o.razorpay_payment_id IS NOT NULL
    AND o.razorpay_payment_id <> NEW.provider_payment_id
  ORDER BY o.id
  LIMIT 1
  FOR UPDATE;
  IF v_conflicting_order IS NOT NULL THEN
    RAISE EXCEPTION
      'duplicate_capture: paid order % is already bound to another payment',
      v_conflicting_order;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_duplicate_capture_for_paid_order
  ON public.payment_captures;
CREATE TRIGGER trg_reject_duplicate_capture_for_paid_order
BEFORE INSERT OR UPDATE OF provider_payment_id, provider_order_id
ON public.payment_captures
FOR EACH ROW EXECUTE FUNCTION finance.reject_duplicate_capture_for_paid_order();

CREATE TABLE IF NOT EXISTS public.cod_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  collector_type text NOT NULL DEFAULT 'seller' CHECK (
    collector_type IN ('seller', 'courier', 'platform')
  ),
  expected_amount_minor bigint NOT NULL CHECK (expected_amount_minor >= 0),
  collected_amount_minor bigint CHECK (collected_amount_minor >= 0),
  status text NOT NULL DEFAULT 'expected' CHECK (
    status IN ('expected', 'collected', 'confirmed', 'reconciled', 'disputed', 'not_received')
  ),
  confirmed_by uuid,
  confirmed_at timestamptz,
  reconciled_at timestamptz,
  proof_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cod_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Buyer can view own COD transaction"
  ON public.cod_transactions FOR SELECT TO authenticated
  USING (buyer_id = auth.uid());
CREATE POLICY "Seller can view own COD transaction"
  ON public.cod_transactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = seller_id
        AND sp.user_id = auth.uid()
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.cod_transactions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cod_transactions TO service_role;

CREATE OR REPLACE FUNCTION finance.track_cod_expected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.payment_type, '') <> 'cod' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.cod_transactions (
    order_id,
    buyer_id,
    seller_id,
    collector_type,
    expected_amount_minor,
    status
  ) VALUES (
    NEW.id,
    NEW.buyer_id,
    NEW.seller_id,
    CASE
      WHEN COALESCE(NEW.delivery_handled_by, '') = 'platform' THEN 'courier'
      ELSE 'seller'
    END,
    round(COALESCE(NEW.total_amount, 0) * 100)::bigint,
    'expected'
  )
  ON CONFLICT (order_id) DO UPDATE
  SET expected_amount_minor = EXCLUDED.expected_amount_minor,
      updated_at = now()
  WHERE public.cod_transactions.status = 'expected';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_cod_expected ON public.orders;
CREATE TRIGGER trg_track_cod_expected
AFTER INSERT OR UPDATE OF payment_type, total_amount ON public.orders
FOR EACH ROW EXECUTE FUNCTION finance.track_cod_expected();

CREATE OR REPLACE FUNCTION finance.track_cod_collected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.payment_method, '') <> 'cod'
     OR COALESCE(NEW.payment_status, '') <> 'paid' THEN
    RETURN NEW;
  END IF;
  UPDATE public.cod_transactions
  SET collected_amount_minor = round(COALESCE(NEW.amount, 0) * 100)::bigint,
      status = 'confirmed',
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      updated_at = now()
  WHERE order_id = NEW.order_id
    AND status IN ('expected', 'collected', 'not_received');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_cod_collected ON public.payment_records;
CREATE TRIGGER trg_track_cod_collected
AFTER INSERT OR UPDATE OF payment_method, payment_status ON public.payment_records
FOR EACH ROW EXECUTE FUNCTION finance.track_cod_collected();

CREATE TABLE IF NOT EXISTS public.financial_reconciliation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  reconciliation_date date NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  internal_amount_minor bigint,
  provider_amount_minor bigint,
  difference_minor bigint GENERATED ALWAYS AS (
    COALESCE(internal_amount_minor, 0) - COALESCE(provider_amount_minor, 0)
  ) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('matched', 'open', 'investigating', 'resolved', 'accepted_exception')
  ),
  reason text,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, reconciliation_date, reference_type, reference_id)
);
ALTER TABLE public.financial_reconciliation_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_reconciliation_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_reconciliation_records TO service_role;

CREATE TABLE IF NOT EXISTS public.payout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.seller_settlements(id),
  provider text NOT NULL,
  request_key text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'succeeded', 'failed', 'unknown', 'reconciliation_required')
  ),
  provider_transfer_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, request_key),
  UNIQUE(provider, provider_transfer_id)
);
ALTER TABLE public.payout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payout_attempts TO service_role;
CREATE INDEX IF NOT EXISTS idx_payout_attempts_reconciliation
  ON public.payout_attempts(status, created_at)
  WHERE status IN ('processing', 'unknown', 'reconciliation_required');

CREATE OR REPLACE FUNCTION public.validate_settlement_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order record;
  v_delivery_status text;
  v_payment_status text;
  v_terminal_success boolean := false;
BEGIN
  IF NEW.settlement_status NOT IN ('settled', 'processing')
     OR OLD.settlement_status = NEW.settlement_status THEN
    RETURN NEW;
  END IF;

  SELECT
    o.status::text AS status,
    o.fulfillment_type,
    o.delivery_handled_by,
    COALESCE(o.transaction_type, o.order_type, 'self_fulfillment') AS workflow,
    o.payment_status
  INTO v_order
  FROM public.orders o
  WHERE o.id = NEW.order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot settle: order % not found', NEW.order_id;
  END IF;

  IF v_order.fulfillment_type = 'self_pickup'
     OR COALESCE(v_order.delivery_handled_by, '') <> 'platform' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.category_status_flows f
      WHERE f.transaction_type = v_order.workflow
        AND f.status_key = v_order.status
        AND f.is_terminal
        AND f.is_success
    ) INTO v_terminal_success;
    IF NOT v_terminal_success
       AND v_order.status NOT IN ('delivered', 'completed') THEN
      RAISE EXCEPTION 'Cannot settle: order % is not successfully completed', NEW.order_id;
    END IF;
  ELSE
    SELECT d.status INTO v_delivery_status
    FROM public.delivery_assignments d
    WHERE d.order_id = NEW.order_id
    LIMIT 1;
    IF v_delivery_status IS DISTINCT FROM 'delivered' THEN
      RAISE EXCEPTION 'Cannot settle: delivery not confirmed for order %', NEW.order_id;
    END IF;
  END IF;

  SELECT pr.payment_status INTO v_payment_status
  FROM public.payment_records pr
  WHERE pr.order_id = NEW.order_id
  LIMIT 1;
  IF v_order.payment_status IS DISTINCT FROM 'paid'
     OR v_payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'Cannot settle: payment not confirmed for order %', NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finance.claim_seller_payout(
  p_settlement_id uuid,
  p_request_key text,
  p_amount_minor bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_settlement public.seller_settlements%ROWTYPE;
  v_order_payment_status text;
  v_attempt_id uuid;
BEGIN
  SELECT * INTO v_settlement
  FROM public.seller_settlements
  WHERE id = p_settlement_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_settlement.settlement_status <> 'eligible'
     OR v_settlement.razorpay_transfer_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_eligible');
  END IF;
  IF round(COALESCE(v_settlement.net_amount, 0) * 100)::bigint <> p_amount_minor THEN
    RAISE EXCEPTION 'payout amount changed before claim';
  END IF;

  SELECT payment_status INTO v_order_payment_status
  FROM public.orders
  WHERE id = v_settlement.order_id
  FOR UPDATE;
  IF v_order_payment_status <> 'paid' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'payment_not_paid');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.refund_requests r
    WHERE r.order_id = v_settlement.order_id
      AND r.refund_state IN (
        'approved', 'refund_initiated', 'refund_processing',
        'needs_manual_review', 'refund_completed'
      )
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'refund_exists');
  END IF;

  INSERT INTO public.payout_attempts (
    settlement_id, provider, request_key, amount_minor, status
  ) VALUES (
    p_settlement_id, 'razorpay_route', p_request_key, p_amount_minor, 'processing'
  )
  RETURNING id INTO v_attempt_id;

  UPDATE public.seller_settlements
  SET settlement_status = 'processing',
      updated_at = now()
  WHERE id = p_settlement_id;

  RETURN jsonb_build_object('claimed', true, 'attempt_id', v_attempt_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'attempt_exists');
END;
$$;

CREATE OR REPLACE FUNCTION finance.finalize_seller_payout(
  p_attempt_id uuid,
  p_provider_transfer_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_attempt public.payout_attempts%ROWTYPE;
  v_rows integer;
BEGIN
  SELECT * INTO v_attempt
  FROM public.payout_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND OR v_attempt.status NOT IN ('processing', 'reconciliation_required') THEN
    RAISE EXCEPTION 'payout attempt is not finalizable';
  END IF;
  IF p_provider_transfer_id IS NULL OR btrim(p_provider_transfer_id) = '' THEN
    RAISE EXCEPTION 'provider transfer id is required';
  END IF;

  UPDATE public.payout_attempts
  SET status = 'succeeded',
      provider_transfer_id = p_provider_transfer_id,
      error_message = NULL,
      updated_at = now()
  WHERE id = p_attempt_id;

  UPDATE public.seller_settlements
  SET settlement_status = 'settled',
      razorpay_transfer_id = p_provider_transfer_id,
      hold_reason = NULL,
      settled_at = now(),
      updated_at = now()
  WHERE id = v_attempt.settlement_id
    AND settlement_status IN ('processing', 'on_hold')
    AND razorpay_transfer_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'settlement finalization affected % rows', v_rows;
  END IF;
  RETURN jsonb_build_object('finalized', true, 'settlement_id', v_attempt.settlement_id);
END;
$$;

CREATE OR REPLACE FUNCTION finance.hold_failed_seller_payout(
  p_attempt_id uuid,
  p_unknown boolean,
  p_error text,
  p_provider_transfer_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_attempt public.payout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt
  FROM public.payout_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout attempt not found';
  END IF;

  UPDATE public.payout_attempts
  SET status = CASE WHEN p_unknown THEN 'reconciliation_required' ELSE 'failed' END,
      provider_transfer_id = COALESCE(p_provider_transfer_id, provider_transfer_id),
      error_message = left(p_error, 1000),
      updated_at = now()
  WHERE id = p_attempt_id;

  UPDATE public.seller_settlements
  SET settlement_status = 'on_hold',
      hold_reason = CASE
        WHEN p_unknown THEN 'Provider outcome unknown; reconcile before retry: '
        ELSE 'Provider payout failed; review before retry: '
      END || left(p_error, 700),
      updated_at = now()
  WHERE id = v_attempt.settlement_id
    AND settlement_status = 'processing';

  RETURN jsonb_build_object('held', true, 'settlement_id', v_attempt.settlement_id);
END;
$$;

CREATE OR REPLACE FUNCTION finance.block_refund_while_payout_processing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_settlement_status text;
BEGIN
  IF NEW.refund_state IN ('refund_initiated', 'refund_processing')
     AND NEW.refund_state IS DISTINCT FROM OLD.refund_state THEN
    SELECT s.settlement_status INTO v_settlement_status
    FROM public.seller_settlements s
    WHERE s.order_id = NEW.order_id
    FOR UPDATE;
    IF v_settlement_status = 'processing' THEN
      RAISE EXCEPTION 'refund cannot start while seller payout is processing';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_refund_while_payout_processing
  ON public.refund_requests;
CREATE TRIGGER trg_block_refund_while_payout_processing
BEFORE UPDATE OF refund_state ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION finance.block_refund_while_payout_processing();

CREATE OR REPLACE FUNCTION public.claim_seller_payout(
  p_settlement_id uuid, p_request_key text, p_amount_minor bigint
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.claim_seller_payout(p_settlement_id, p_request_key, p_amount_minor);
$$;
CREATE OR REPLACE FUNCTION public.finalize_seller_payout(
  p_attempt_id uuid, p_provider_transfer_id text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.finalize_seller_payout(p_attempt_id, p_provider_transfer_id);
$$;
CREATE OR REPLACE FUNCTION public.hold_failed_seller_payout(
  p_attempt_id uuid, p_unknown boolean, p_error text,
  p_provider_transfer_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.hold_failed_seller_payout(
    p_attempt_id, p_unknown, p_error, p_provider_transfer_id
  );
$$;
REVOKE ALL ON FUNCTION public.claim_seller_payout(uuid, text, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_seller_payout(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hold_failed_seller_payout(uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_seller_payout(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_seller_payout(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hold_failed_seller_payout(uuid, boolean, text, text) TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_requests_gateway_refund_id
  ON public.refund_requests(gateway_refund_id)
  WHERE gateway_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.refund_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refund_requests(id),
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  request_key text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'succeeded', 'failed', 'unknown', 'reconciliation_required')
  ),
  provider_refund_id text,
  provider_status text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, request_key),
  UNIQUE(provider, provider_refund_id)
);
ALTER TABLE public.refund_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.refund_attempts TO service_role;
CREATE INDEX IF NOT EXISTS idx_refund_attempts_reconciliation
  ON public.refund_attempts(status, created_at)
  WHERE status IN ('processing', 'unknown', 'reconciliation_required');

CREATE TABLE IF NOT EXISTS public.financial_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.financial_feature_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_feature_flags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_feature_flags TO service_role;

CREATE TABLE IF NOT EXISTS public.financial_configuration (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.financial_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_configuration FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_configuration TO service_role;

INSERT INTO public.financial_configuration(key, value, description)
VALUES (
  'provider_payout_mode',
  'disabled',
  'Allowed values: disabled or razorpay_route_deferred after reviewed approval'
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = now();

INSERT INTO public.financial_feature_flags(key, enabled, description)
VALUES
  ('ledger_shadow_write', true, 'Write approved events to the finance subledger in shadow mode'),
  ('ledger_read_projection', false, 'Use finance subledger projections for user-visible balances'),
  ('seller_payout_enabled', false, 'Allow provider-backed seller payouts after reconciliation gate'),
  ('razorpay_route_order_transfer_enabled', false, 'Attach Route transfers at Razorpay order creation'),
  ('buyer_credit_enabled', true, 'Enable non-loadable SOCIVA Credit'),
  ('buyer_withdrawal_enabled', false, 'Requires approved regulated partner and legal sign-off'),
  ('buyer_topup_enabled', false, 'Requires approved regulated partner and legal sign-off'),
  ('buyer_p2p_enabled', false, 'Requires approved regulated partner and legal sign-off'),
  ('wallet_spend_enabled', false, 'Staged kill switch; existing reads and refunds remain available'),
  ('wallet_issue_enabled', false, 'Blocks new promo/support issuance until staged approval'),
  ('wallet_refund_credit_enabled', false, 'Original-method remains default until credit-refund rollout approval'),
  ('cod_payable_offset_enabled', false, 'COD fees are not automatically netted against online payable')
ON CONFLICT (key) DO UPDATE
SET enabled = EXCLUDED.enabled,
    description = EXCLUDED.description,
    updated_at = now();

CREATE OR REPLACE FUNCTION finance.enforce_wallet_reservation_switch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF NOT COALESCE((
    SELECT enabled
    FROM public.financial_feature_flags
    WHERE key = 'wallet_spend_enabled'
  ), false) THEN
    RAISE EXCEPTION 'SOCIVA Credit spend is temporarily disabled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_wallet_reservation_switch
  ON public.wallet_reservations;
CREATE TRIGGER trg_enforce_wallet_reservation_switch
BEFORE INSERT ON public.wallet_reservations
FOR EACH ROW EXECUTE FUNCTION finance.enforce_wallet_reservation_switch();

CREATE OR REPLACE FUNCTION finance.enforce_wallet_credit_issue_switch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_flag text;
BEGIN
  IF NEW.source IN ('spend_restore', 'clawback_adjust') THEN
    RETURN NEW;
  END IF;
  v_flag := CASE
    WHEN NEW.source = 'refund' THEN 'wallet_refund_credit_enabled'
    ELSE 'wallet_issue_enabled'
  END;
  IF NOT COALESCE((
    SELECT enabled
    FROM public.financial_feature_flags
    WHERE key = v_flag
  ), false) THEN
    RAISE EXCEPTION 'SOCIVA Credit issuance is disabled for source %', NEW.source;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_wallet_credit_issue_switch
  ON public.wallet_credit_lots;
CREATE TRIGGER trg_enforce_wallet_credit_issue_switch
BEFORE INSERT ON public.wallet_credit_lots
FOR EACH ROW EXECUTE FUNCTION finance.enforce_wallet_credit_issue_switch();

CREATE OR REPLACE FUNCTION finance.validate_capture_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_capture_id uuid := COALESCE(NEW.capture_id, OLD.capture_id);
  v_capture_amount bigint;
  v_allocated_amount bigint;
BEGIN
  SELECT amount_minor INTO v_capture_amount
  FROM public.payment_captures
  WHERE id = v_capture_id;

  SELECT COALESCE(sum(amount_minor), 0) INTO v_allocated_amount
  FROM public.payment_capture_allocations
  WHERE capture_id = v_capture_id;

  IF v_allocated_amount <> v_capture_amount THEN
    RAISE EXCEPTION
      'capture allocation mismatch for %: capture %, allocated %',
      v_capture_id, v_capture_amount, v_allocated_amount;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_capture_allocation_total
  ON public.payment_capture_allocations;
CREATE CONSTRAINT TRIGGER trg_validate_capture_allocation_total
AFTER INSERT OR UPDATE OR DELETE ON public.payment_capture_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION finance.validate_capture_allocation_total();

CREATE OR REPLACE FUNCTION finance.shadow_post_payment_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT enabled INTO v_enabled
  FROM public.financial_feature_flags
  WHERE key = 'ledger_shadow_write';
  IF COALESCE(v_enabled, false) = false OR NEW.status <> 'captured' THEN
    RETURN NEW;
  END IF;

  PERFORM finance.post_journal(
    'PAYMENT_CAPTURED',
    'payment_capture',
    NEW.id::text,
    'capture:' || NEW.provider || ':' || NEW.provider_payment_id,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', 'gateway_clearing',
        'direction', 'debit',
        'amount_minor', NEW.amount_minor
      ),
      jsonb_build_object(
        'account_code', 'financial_suspense',
        'direction', 'credit',
        'amount_minor', NEW.amount_minor
      )
    ),
    'Razorpay payment captured into allocation suspense',
    jsonb_build_object(
      'provider', NEW.provider,
      'provider_payment_id', NEW.provider_payment_id,
      'provider_order_id', NEW.provider_order_id
    ),
    COALESCE(NEW.captured_at, NEW.created_at),
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shadow_post_payment_capture ON public.payment_captures;
CREATE TRIGGER trg_shadow_post_payment_capture
AFTER INSERT OR UPDATE OF status ON public.payment_captures
FOR EACH ROW EXECUTE FUNCTION finance.shadow_post_payment_capture();

CREATE OR REPLACE FUNCTION finance.shadow_post_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT enabled INTO v_enabled
  FROM public.financial_feature_flags
  WHERE key = 'ledger_shadow_write';
  IF COALESCE(v_enabled, false) = false OR NEW.amount_minor <= 0 THEN
    RETURN NEW;
  END IF;

  PERFORM finance.post_journal(
    'PAYMENT_ALLOCATED',
    'payment_capture_allocation',
    NEW.id::text,
    'capture-allocation:' || NEW.id::text,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', 'financial_suspense',
        'direction', 'debit',
        'amount_minor', NEW.amount_minor,
        'order_id', NEW.order_id
      ),
      jsonb_build_object(
        'account_code', 'seller_payable_pending',
        'direction', 'credit',
        'amount_minor', NEW.amount_minor,
        'order_id', NEW.order_id,
        'metadata', jsonb_build_object('seller_id', NEW.seller_id)
      )
    ),
    'Captured payment allocated to child seller order',
    jsonb_build_object('seller_id', NEW.seller_id, 'capture_id', NEW.capture_id),
    NEW.created_at,
    NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shadow_post_payment_allocation
  ON public.payment_capture_allocations;
CREATE TRIGGER trg_shadow_post_payment_allocation
AFTER INSERT ON public.payment_capture_allocations
FOR EACH ROW EXECUTE FUNCTION finance.shadow_post_payment_allocation();

CREATE OR REPLACE VIEW finance.capture_allocation_variances AS
SELECT
  c.id AS capture_id,
  c.provider,
  c.provider_payment_id,
  c.amount_minor AS captured_amount_minor,
  COALESCE(sum(a.amount_minor), 0)::bigint AS allocated_amount_minor,
  (c.amount_minor - COALESCE(sum(a.amount_minor), 0))::bigint AS difference_minor,
  c.status,
  c.created_at
FROM public.payment_captures c
LEFT JOIN public.payment_capture_allocations a ON a.capture_id = c.id
GROUP BY c.id;

CREATE OR REPLACE VIEW finance.ledger_account_balances AS
SELECT
  a.id AS account_id,
  a.code,
  a.name,
  a.account_type,
  a.owner_type,
  a.owner_id,
  a.currency,
  COALESCE(sum(
    CASE e.direction
      WHEN 'debit' THEN e.amount_minor
      ELSE -e.amount_minor
    END
  ), 0)::bigint AS debit_positive_balance_minor,
  max(e.created_at) AS last_entry_at
FROM finance.ledger_accounts a
LEFT JOIN finance.ledger_entries e ON e.account_id = a.id
GROUP BY a.id;

CREATE OR REPLACE VIEW finance.seller_payable_shadow AS
SELECT
  NULLIF(e.metadata->>'seller_id', '')::uuid AS seller_id,
  e.currency,
  COALESCE(sum(
    CASE e.direction
      WHEN 'credit' THEN e.amount_minor
      ELSE -e.amount_minor
    END
  ), 0)::bigint AS payable_minor,
  count(DISTINCT e.transaction_id)::bigint AS journal_count,
  max(e.created_at) AS updated_at
FROM finance.ledger_entries e
JOIN finance.ledger_accounts a ON a.id = e.account_id
WHERE a.code IN ('seller_payable_pending', 'seller_payable_available')
  AND e.metadata ? 'seller_id'
GROUP BY NULLIF(e.metadata->>'seller_id', '')::uuid, e.currency;

CREATE OR REPLACE VIEW finance.journal_integrity_violations AS
SELECT
  t.id AS transaction_id,
  t.idempotency_key,
  t.currency,
  COALESCE(sum(e.amount_minor) FILTER (WHERE e.direction = 'debit'), 0)::bigint AS debit_minor,
  COALESCE(sum(e.amount_minor) FILTER (WHERE e.direction = 'credit'), 0)::bigint AS credit_minor
FROM finance.ledger_transactions t
LEFT JOIN finance.ledger_entries e ON e.transaction_id = t.id
WHERE t.posted_at IS NOT NULL
GROUP BY t.id
HAVING COALESCE(sum(e.amount_minor) FILTER (WHERE e.direction = 'debit'), 0)
    <> COALESCE(sum(e.amount_minor) FILTER (WHERE e.direction = 'credit'), 0);

CREATE TABLE IF NOT EXISTS public.financial_backfill_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_reference text NOT NULL,
  proposed_amount_minor bigint NOT NULL CHECK (proposed_amount_minor >= 0),
  currency text NOT NULL DEFAULT 'INR',
  evidence jsonb NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'ambiguous')),
  review_status text NOT NULL DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'applied')
  ),
  reviewed_by uuid,
  reviewed_at timestamptz,
  applied_transaction_id uuid REFERENCES finance.ledger_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type, source_reference)
);
ALTER TABLE public.financial_backfill_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_backfill_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_backfill_candidates TO service_role;

-- Historical rows are candidates only. No journal or provider capture is
-- invented from mutable local snapshots without provider/controller review.
INSERT INTO public.financial_backfill_candidates (
  source_type,
  source_reference,
  proposed_amount_minor,
  evidence,
  confidence
)
SELECT
  'razorpay_payment',
  pr.razorpay_payment_id,
  round(sum(COALESCE(o.total_amount, pr.amount, 0)) * 100)::bigint,
  jsonb_build_object(
    'payment_record_ids', jsonb_agg(pr.id ORDER BY pr.id),
    'order_ids', jsonb_agg(pr.order_id ORDER BY pr.order_id),
    'payment_statuses', jsonb_agg(DISTINCT pr.payment_status),
    'reason', 'Local paid records require provider capture and settlement evidence'
  ),
  CASE
    WHEN bool_and(pr.payment_status = 'paid') THEN 'medium'
    ELSE 'ambiguous'
  END
FROM public.payment_records pr
LEFT JOIN public.orders o ON o.id = pr.order_id
WHERE pr.razorpay_payment_id IS NOT NULL
GROUP BY pr.razorpay_payment_id
ON CONFLICT (source_type, source_reference) DO NOTHING;

CREATE OR REPLACE FUNCTION finance.run_financial_reconciliation(
  p_reconciliation_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_capture_mismatches integer;
  v_payout_mismatches integer;
  v_refund_mismatches integer;
  v_journal_mismatches integer;
BEGIN
  INSERT INTO public.financial_reconciliation_records (
    provider, reconciliation_date, reference_type, reference_id,
    internal_amount_minor, provider_amount_minor, status, reason, updated_at
  )
  SELECT
    v.provider,
    p_reconciliation_date,
    'payment_capture',
    v.provider_payment_id,
    v.allocated_amount_minor,
    v.captured_amount_minor,
    CASE WHEN v.difference_minor = 0 THEN 'matched' ELSE 'open' END,
    CASE WHEN v.difference_minor = 0 THEN NULL ELSE 'Capture allocation does not equal provider capture' END,
    now()
  FROM finance.capture_allocation_variances v
  ON CONFLICT (provider, reconciliation_date, reference_type, reference_id)
  DO UPDATE SET
    internal_amount_minor = EXCLUDED.internal_amount_minor,
    provider_amount_minor = EXCLUDED.provider_amount_minor,
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    updated_at = now();
  SELECT count(*) INTO v_capture_mismatches
  FROM public.financial_reconciliation_records
  WHERE reconciliation_date = p_reconciliation_date
    AND reference_type = 'payment_capture'
    AND status IN ('open', 'investigating');

  INSERT INTO public.financial_reconciliation_records (
    provider, reconciliation_date, reference_type, reference_id,
    internal_amount_minor, provider_amount_minor, status, reason, updated_at
  )
  SELECT
    pa.provider,
    p_reconciliation_date,
    'payout_attempt',
    pa.id::text,
    pa.amount_minor,
    CASE
      WHEN s.razorpay_transfer_id = pa.provider_transfer_id
           AND s.settlement_status = 'settled'
      THEN pa.amount_minor
      ELSE 0
    END,
    CASE
      WHEN s.razorpay_transfer_id = pa.provider_transfer_id
           AND s.settlement_status = 'settled'
      THEN 'matched'
      ELSE 'open'
    END,
    CASE
      WHEN s.razorpay_transfer_id = pa.provider_transfer_id
           AND s.settlement_status = 'settled'
      THEN NULL
      ELSE 'Successful payout attempt does not match settled provider transfer'
    END,
    now()
  FROM public.payout_attempts pa
  JOIN public.seller_settlements s ON s.id = pa.settlement_id
  WHERE pa.status = 'succeeded'
  ON CONFLICT (provider, reconciliation_date, reference_type, reference_id)
  DO UPDATE SET
    internal_amount_minor = EXCLUDED.internal_amount_minor,
    provider_amount_minor = EXCLUDED.provider_amount_minor,
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    updated_at = now();
  SELECT count(*) INTO v_payout_mismatches
  FROM public.financial_reconciliation_records
  WHERE reconciliation_date = p_reconciliation_date
    AND reference_type = 'payout_attempt'
    AND status IN ('open', 'investigating');

  INSERT INTO public.financial_reconciliation_records (
    provider, reconciliation_date, reference_type, reference_id,
    internal_amount_minor, provider_amount_minor, status, reason, updated_at
  )
  SELECT
    ra.provider,
    p_reconciliation_date,
    'refund_attempt',
    ra.id::text,
    ra.amount_minor,
    CASE
      WHEN rr.gateway_refund_id = ra.provider_refund_id
           AND rr.refund_state = 'refund_completed'
      THEN ra.amount_minor
      ELSE 0
    END,
    CASE
      WHEN rr.gateway_refund_id = ra.provider_refund_id
           AND rr.refund_state = 'refund_completed'
      THEN 'matched'
      ELSE 'open'
    END,
    CASE
      WHEN rr.gateway_refund_id = ra.provider_refund_id
           AND rr.refund_state = 'refund_completed'
      THEN NULL
      ELSE 'Successful refund attempt does not match completed refund'
    END,
    now()
  FROM public.refund_attempts ra
  JOIN public.refund_requests rr ON rr.id = ra.refund_id
  WHERE ra.status = 'succeeded'
  ON CONFLICT (provider, reconciliation_date, reference_type, reference_id)
  DO UPDATE SET
    internal_amount_minor = EXCLUDED.internal_amount_minor,
    provider_amount_minor = EXCLUDED.provider_amount_minor,
    status = EXCLUDED.status,
    reason = EXCLUDED.reason,
    updated_at = now();
  SELECT count(*) INTO v_refund_mismatches
  FROM public.financial_reconciliation_records
  WHERE reconciliation_date = p_reconciliation_date
    AND reference_type = 'refund_attempt'
    AND status IN ('open', 'investigating');

  INSERT INTO public.financial_reconciliation_records (
    provider, reconciliation_date, reference_type, reference_id,
    internal_amount_minor, provider_amount_minor, status, reason, updated_at
  )
  SELECT
    'internal',
    p_reconciliation_date,
    'ledger_transaction',
    j.transaction_id::text,
    j.debit_minor,
    j.credit_minor,
    'open',
    'Posted journal is unbalanced',
    now()
  FROM finance.journal_integrity_violations j
  ON CONFLICT (provider, reconciliation_date, reference_type, reference_id)
  DO UPDATE SET
    internal_amount_minor = EXCLUDED.internal_amount_minor,
    provider_amount_minor = EXCLUDED.provider_amount_minor,
    status = 'open',
    reason = EXCLUDED.reason,
    updated_at = now();
  SELECT count(*) INTO v_journal_mismatches
  FROM public.financial_reconciliation_records
  WHERE reconciliation_date = p_reconciliation_date
    AND reference_type = 'ledger_transaction'
    AND status IN ('open', 'investigating');

  RETURN jsonb_build_object(
    'capture_mismatches', v_capture_mismatches,
    'payout_mismatches', v_payout_mismatches,
    'refund_mismatches', v_refund_mismatches,
    'journal_violations', v_journal_mismatches,
    'reconciliation_date', p_reconciliation_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.run_financial_reconciliation(
  p_reconciliation_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.run_financial_reconciliation(p_reconciliation_date);
$$;
REVOKE ALL ON FUNCTION public.run_financial_reconciliation(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_financial_reconciliation(date) TO service_role;

-- Remove obsolete client authority over payment truth. Keep reads governed by
-- existing ownership/admin policies.
DROP POLICY IF EXISTS "Buyers can insert payment records" ON public.payment_records;
DROP POLICY IF EXISTS "Users can insert payment records" ON public.payment_records;
DROP POLICY IF EXISTS "Authenticated can insert payment records" ON public.payment_records;
DROP POLICY IF EXISTS "System can create payment records" ON public.payment_records;
REVOKE INSERT, UPDATE, DELETE ON public.payment_records FROM anon, authenticated;

-- Internal wallet helpers are callable only by their owner or service role.
-- Public read/quote APIs and the ownership-checked release RPC remain available.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'wallet_ensure_wallet',
        'wallet_plan_spend',
        'wallet_insert_entry',
        'wallet_consume_lots',
        'reserve_wallet_credit',
        'commit_wallet_reservation',
        'commit_wallet_for_orders',
        'credit_wallet_cash',
        'issue_wallet_promo',
        'restore_wallet_for_order',
        'credit_wallet_from_refund',
        'expire_wallet_lots',
        'admin_wallet_liability',
        'apply_wallet_to_checkout_orders'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'wallet_plan_spend'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.signature);
  END LOOP;
END;
$$;

COMMIT;
