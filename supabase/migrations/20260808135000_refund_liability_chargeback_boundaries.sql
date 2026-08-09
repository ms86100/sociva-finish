-- Atomic refunds, immutable allocation evidence and post-payout liabilities.
BEGIN;

CREATE TABLE IF NOT EXISTS public.refund_allocation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL UNIQUE REFERENCES public.refund_requests(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  tender_snapshot jsonb NOT NULL,
  item_snapshot jsonb NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  shipping_minor bigint NOT NULL DEFAULT 0,
  discount_minor bigint NOT NULL DEFAULT 0,
  discount_sponsor_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  gateway_refund_minor bigint NOT NULL CHECK (gateway_refund_minor >= 0),
  wallet_refund_minor bigint NOT NULL DEFAULT 0 CHECK (wallet_refund_minor >= 0),
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seller_liability_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id),
  entry_type text NOT NULL CHECK (
    entry_type IN (
      'post_payout_refund', 'chargeback', 'return_reserve',
      'payout_offset', 'manual_recovery', 'reversal'
    )
  ),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  reverses_entry_id uuid REFERENCES public.seller_liability_entries(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW finance.seller_liability_balances AS
SELECT
  seller_id,
  COALESCE(sum(amount_minor), 0)::bigint AS liability_minor,
  max(created_at) AS updated_at
FROM public.seller_liability_entries
GROUP BY seller_id;

CREATE TABLE IF NOT EXISTS public.chargeback_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_case_id text NOT NULL,
  provider_payment_id text NOT NULL,
  order_id uuid REFERENCES public.orders(id),
  seller_id uuid REFERENCES public.seller_profiles(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (
    status IN ('opened', 'evidence_due', 'won', 'lost', 'reversed')
  ),
  evidence_due_at timestamptz,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_case_id)
);

CREATE TABLE IF NOT EXISTS public.chargeback_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chargeback_id uuid NOT NULL REFERENCES public.chargeback_cases(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chargeback_id, order_id)
);

CREATE TABLE IF NOT EXISTS public.seller_return_reserves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  refund_id uuid REFERENCES public.refund_requests(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'held' CHECK (
    status IN ('held', 'released', 'applied')
  ),
  hold_until timestamptz NOT NULL,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, refund_id)
);

ALTER TABLE public.refund_allocation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_liability_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chargeback_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chargeback_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_return_reserves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_allocation_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_liability_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chargeback_cases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chargeback_allocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.seller_return_reserves FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.refund_allocation_snapshots TO service_role;
GRANT SELECT, INSERT ON public.seller_liability_entries TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.chargeback_cases TO service_role;
GRANT SELECT, INSERT ON public.chargeback_allocations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.seller_return_reserves TO service_role;

INSERT INTO finance.ledger_accounts (
  code, name, account_type, normal_balance
) VALUES
  ('seller_liability_receivable', 'Recoverable seller liability', 'asset', 'debit'),
  ('chargeback_receivable', 'Chargeback receivable from seller', 'asset', 'debit'),
  ('return_reserve_control', 'Seller return reserve', 'liability', 'credit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO finance.journal_templates (
  event_type, description, required_account_codes
) VALUES
  (
    'SELLER_POST_PAYOUT_LIABILITY',
    'Post-payout refund recoverable from seller',
    ARRAY['seller_liability_receivable', 'refund_payable']
  ),
  (
    'CHARGEBACK_OPENED',
    'Provider chargeback opened against seller',
    ARRAY['chargeback_receivable', 'gateway_clearing']
  ),
  (
    'RETURN_RESERVE_HELD',
    'Seller return reserve held',
    ARRAY['return_reserve_control']
  )
ON CONFLICT (event_type) DO UPDATE
SET description = EXCLUDED.description,
    required_account_codes = EXCLUDED.required_account_codes,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.claim_refund_attempt(
  p_refund_id uuid,
  p_provider_payment_id text,
  p_request_key text,
  p_amount_minor bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_refund public.refund_requests%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_attempt public.refund_attempts%ROWTYPE;
  v_expected numeric;
  v_settlement_status text;
  v_items jsonb;
BEGIN
  SELECT * INTO v_refund
  FROM public.refund_requests
  WHERE id = p_refund_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund not found';
  END IF;
  IF v_refund.refund_state NOT IN ('approved', 'refund_initiated') THEN
    RETURN jsonb_build_object(
      'claimed', false, 'reason', 'invalid_refund_state',
      'state', v_refund.refund_state
    );
  END IF;
  IF p_provider_payment_id IS NULL OR btrim(p_provider_payment_id) = '' THEN
    RAISE EXCEPTION 'provider payment id required';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_refund.order_id
  FOR UPDATE;
  SELECT settlement_status INTO v_settlement_status
  FROM public.seller_settlements
  WHERE order_id = v_refund.order_id
  FOR UPDATE;
  IF v_settlement_status = 'processing' THEN
    RAISE EXCEPTION 'refund cannot start while payout is processing';
  END IF;

  SELECT public.compute_child_gateway_refund_amount(v_refund.order_id)
  INTO v_expected;
  IF p_amount_minor <> round(COALESCE(v_expected, 0) * 100)::bigint THEN
    RAISE EXCEPTION 'refund amount does not match server allocation';
  END IF;

  SELECT * INTO v_attempt
  FROM public.refund_attempts
  WHERE provider = 'razorpay'
    AND request_key = p_request_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.refund_id <> p_refund_id
       OR v_attempt.provider_payment_id <> p_provider_payment_id
       OR v_attempt.amount_minor <> p_amount_minor THEN
      RAISE EXCEPTION 'refund idempotency key payload mismatch';
    END IF;
    RETURN jsonb_build_object(
      'claimed', false, 'deduplicated', true,
      'attempt_id', v_attempt.id, 'status', v_attempt.status,
      'provider_refund_id', v_attempt.provider_refund_id,
      'provider_status', v_attempt.provider_status
    );
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(oi) ORDER BY oi.id), '[]'::jsonb)
  INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  INSERT INTO public.refund_allocation_snapshots (
    refund_id, order_id, tender_snapshot, item_snapshot,
    shipping_minor, discount_minor, discount_sponsor_snapshot,
    gateway_refund_minor, wallet_refund_minor
  ) VALUES (
    v_refund.id,
    v_order.id,
    jsonb_build_object(
      'payment_type', v_order.payment_type,
      'razorpay_payment_id', p_provider_payment_id,
      'wallet_cash_minor', round(COALESCE(v_order.wallet_cash_amount, 0) * 100),
      'wallet_promo_minor', round(COALESCE(v_order.wallet_promo_amount, 0) * 100)
    ),
    v_items,
    round(COALESCE(v_order.delivery_fee, 0) * 100),
    round(COALESCE(v_order.loyalty_discount_amount, 0) * 100),
    jsonb_build_object(
      'loyalty', 'platform',
      'wallet_promo', 'platform',
      'coupon', 'snapshot_required_from_items'
    ),
    p_amount_minor,
    round((
      COALESCE(v_order.wallet_cash_amount, 0)
      + COALESCE(v_order.wallet_promo_amount, 0)
    ) * 100)
  )
  ON CONFLICT (refund_id) DO NOTHING;

  INSERT INTO public.refund_attempts (
    refund_id, provider, provider_payment_id, request_key,
    amount_minor, status
  ) VALUES (
    p_refund_id, 'razorpay', p_provider_payment_id, p_request_key,
    p_amount_minor, 'processing'
  )
  RETURNING * INTO v_attempt;

  UPDATE public.refund_requests
  SET refund_state = 'refund_initiated',
      status = 'processing',
      updated_at = now()
  WHERE id = p_refund_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'attempt_id', v_attempt.id,
    'post_payout_liability_required', v_settlement_status = 'settled'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_refund_attempt(
  uuid, text, text, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_refund_attempt(
  uuid, text, text, bigint
) TO service_role;

CREATE OR REPLACE FUNCTION finance.block_refund_while_payout_processing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_settlement_status text;
BEGIN
  IF NEW.refund_state IN (
       'approved', 'refund_initiated', 'refund_processing'
     )
     AND NEW.refund_state IS DISTINCT FROM OLD.refund_state THEN
    SELECT settlement_status INTO v_settlement_status
    FROM public.seller_settlements
    WHERE order_id = NEW.order_id
    FOR UPDATE;
    IF v_settlement_status = 'processing' THEN
      RAISE EXCEPTION 'refund cannot start while seller payout is processing';
    END IF;
    -- A settled payout is allowed only because completion creates an immutable
    -- seller liability entry and blocks future payouts until controlled offset.
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION finance.record_completed_refund_liability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_settlement public.seller_settlements%ROWTYPE;
  v_amount_minor bigint;
BEGIN
  IF NEW.refund_state <> 'refund_completed'
     OR OLD.refund_state = 'refund_completed' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_settlement
  FROM public.seller_settlements
  WHERE order_id = NEW.order_id;
  IF NOT FOUND OR v_settlement.settlement_status <> 'settled' THEN
    RETURN NEW;
  END IF;
  SELECT gateway_refund_minor INTO v_amount_minor
  FROM public.refund_allocation_snapshots
  WHERE refund_id = NEW.id;
  IF v_amount_minor IS NULL OR v_amount_minor <= 0 THEN
    RAISE EXCEPTION 'completed post-payout refund lacks allocation snapshot';
  END IF;

  INSERT INTO public.seller_liability_entries (
    seller_id, entry_type, amount_minor, reference_type, reference_id,
    idempotency_key, metadata
  ) VALUES (
    v_settlement.seller_id, 'post_payout_refund', v_amount_minor,
    'refund', NEW.id::text, 'seller-refund-liability:' || NEW.id::text,
    jsonb_build_object(
      'settlement_id', v_settlement.id,
      'provider_transfer_id', v_settlement.razorpay_transfer_id
    )
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  PERFORM finance.post_journal(
    'SELLER_POST_PAYOUT_LIABILITY', 'refund', NEW.id::text,
    'seller-refund-liability-journal:' || NEW.id::text,
    jsonb_build_array(
      jsonb_build_object(
        'account_code', 'seller_liability_receivable', 'direction', 'debit',
        'amount_minor', v_amount_minor, 'refund_id', NEW.id,
        'settlement_id', v_settlement.id,
        'metadata', jsonb_build_object('seller_id', v_settlement.seller_id)
      ),
      jsonb_build_object(
        'account_code', 'refund_payable', 'direction', 'credit',
        'amount_minor', v_amount_minor, 'refund_id', NEW.id,
        'settlement_id', v_settlement.id
      )
    ),
    'Post-payout seller refund liability',
    jsonb_build_object('seller_id', v_settlement.seller_id),
    now(), NULL
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_completed_refund_liability
  ON public.refund_requests;
CREATE TRIGGER trg_record_completed_refund_liability
AFTER UPDATE OF refund_state ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION finance.record_completed_refund_liability();

CREATE OR REPLACE FUNCTION finance.manage_refund_return_reserve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reserve public.seller_return_reserves%ROWTYPE;
  v_amount_minor bigint;
  v_journal_id uuid;
  v_settlement_status text;
  v_payable_account text;
BEGIN
  IF NEW.refund_state = 'approved'
     AND OLD.refund_state IS DISTINCT FROM 'approved' THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = NEW.order_id
    FOR UPDATE;
    SELECT settlement_status INTO v_settlement_status
    FROM public.seller_settlements
    WHERE order_id = NEW.order_id
    FOR UPDATE;
    IF v_settlement_status IS NULL OR v_settlement_status = 'settled' THEN
      RETURN NEW;
    END IF;
    v_payable_account := CASE
      WHEN v_settlement_status = 'eligible' THEN 'seller_payable_available'
      ELSE 'seller_payable_pending'
    END;
    v_amount_minor := round(
      COALESCE(public.compute_child_gateway_refund_amount(NEW.order_id), 0) * 100
    )::bigint;
    IF v_amount_minor <= 0 THEN
      RAISE EXCEPTION 'return reserve requires server-computed refund amount';
    END IF;

    INSERT INTO public.seller_return_reserves (
      seller_id, order_id, refund_id, amount_minor, hold_until
    ) VALUES (
      v_order.seller_id, v_order.id, NEW.id, v_amount_minor,
      now() + interval '14 days'
    )
    ON CONFLICT (order_id, refund_id) DO UPDATE
    SET amount_minor = EXCLUDED.amount_minor,
        updated_at = now()
    WHERE public.seller_return_reserves.status = 'held'
      AND public.seller_return_reserves.amount_minor = EXCLUDED.amount_minor
    RETURNING * INTO v_reserve;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'existing return reserve payload mismatch';
    END IF;

    PERFORM finance.post_journal(
      'REFUND_REQUESTED', 'refund', NEW.id::text,
      'refund-requested:' || NEW.id::text,
      jsonb_build_array(
        jsonb_build_object(
          'account_code', v_payable_account, 'direction', 'debit',
          'amount_minor', v_amount_minor, 'order_id', NEW.order_id,
          'refund_id', NEW.id,
          'metadata', jsonb_build_object('seller_id', v_order.seller_id)
        ),
        jsonb_build_object(
          'account_code', 'refund_payable', 'direction', 'credit',
          'amount_minor', v_amount_minor, 'order_id', NEW.order_id,
          'refund_id', NEW.id,
          'metadata', jsonb_build_object('seller_id', v_order.seller_id)
        )
      ),
      'Refund liability reserved from seller payable',
      jsonb_build_object('seller_id', v_order.seller_id),
      now(), NULL
    );
  ELSIF NEW.refund_state = 'refund_completed'
     AND OLD.refund_state IS DISTINCT FROM 'refund_completed' THEN
    UPDATE public.seller_return_reserves
    SET status = 'applied', updated_at = now()
    WHERE refund_id = NEW.id AND status = 'held';
    IF COALESCE(NEW.refund_destination, 'original_payment')
       = 'original_payment' THEN
      SELECT gateway_refund_minor INTO v_amount_minor
      FROM public.refund_allocation_snapshots
      WHERE refund_id = NEW.id;
      IF v_amount_minor IS NULL OR v_amount_minor <= 0 THEN
        RAISE EXCEPTION 'completed gateway refund lacks allocation snapshot';
      END IF;
      PERFORM finance.post_journal(
        'REFUND_PROCESSED', 'refund', NEW.id::text,
        'refund-processed:' || NEW.id::text,
        jsonb_build_array(
          jsonb_build_object(
            'account_code', 'refund_payable', 'direction', 'debit',
            'amount_minor', v_amount_minor, 'order_id', NEW.order_id,
            'refund_id', NEW.id
          ),
          jsonb_build_object(
            'account_code', 'gateway_clearing', 'direction', 'credit',
            'amount_minor', v_amount_minor, 'order_id', NEW.order_id,
            'refund_id', NEW.id
          )
        ),
        'Provider refund completed',
        jsonb_build_object('gateway_refund_id', NEW.gateway_refund_id),
        now(), NULL
      );
    END IF;
  ELSIF NEW.refund_state IN ('rejected', 'refund_failed')
     AND OLD.refund_state NOT IN ('rejected', 'refund_failed') THEN
    UPDATE public.seller_return_reserves
    SET status = 'released',
        release_reason = 'Refund did not complete',
        updated_at = now()
    WHERE refund_id = NEW.id AND status = 'held';
    SELECT id INTO v_journal_id
    FROM finance.ledger_transactions
    WHERE idempotency_key = 'refund-requested:' || NEW.id::text;
    IF v_journal_id IS NOT NULL THEN
      PERFORM finance.reverse_posted_journal(
        v_journal_id,
        'refund-requested-reversal:' || NEW.id::text,
        'Refund failed or was rejected'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manage_refund_return_reserve
  ON public.refund_requests;
CREATE TRIGGER trg_manage_refund_return_reserve
AFTER UPDATE OF refund_state ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION finance.manage_refund_return_reserve();

CREATE OR REPLACE FUNCTION finance.block_payout_with_seller_liability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF NEW.settlement_status IN ('eligible', 'processing')
     AND NEW.settlement_status IS DISTINCT FROM OLD.settlement_status
     AND COALESCE((
       SELECT liability_minor
       FROM finance.seller_liability_balances
       WHERE seller_id = NEW.seller_id
     ), 0) > 0 THEN
    RAISE EXCEPTION 'payout blocked: seller liability requires controlled offset';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_payout_with_seller_liability
  ON public.seller_settlements;
CREATE TRIGGER trg_block_payout_with_seller_liability
BEFORE UPDATE OF settlement_status ON public.seller_settlements
FOR EACH ROW EXECUTE FUNCTION finance.block_payout_with_seller_liability();

CREATE OR REPLACE FUNCTION public.record_provider_chargeback(
  p_provider text,
  p_provider_case_id text,
  p_provider_payment_id text,
  p_amount_minor bigint,
  p_status text,
  p_raw_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_capture public.payment_captures%ROWTYPE;
  v_case_id uuid;
  v_allocation record;
  v_allocated bigint := 0;
  v_count integer;
  v_index integer := 0;
  v_amount bigint;
BEGIN
  SELECT * INTO v_capture
  FROM public.payment_captures
  WHERE provider = p_provider
    AND provider_payment_id = p_provider_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chargeback payment has no exact capture';
  END IF;
  IF p_amount_minor <= 0 OR p_amount_minor > v_capture.amount_minor THEN
    RAISE EXCEPTION 'chargeback amount exceeds provider capture';
  END IF;

  INSERT INTO public.chargeback_cases (
    provider, provider_case_id, provider_payment_id,
    amount_minor, status, raw_payload
  ) VALUES (
    p_provider, p_provider_case_id, p_provider_payment_id,
    p_amount_minor, p_status, p_raw_payload
  )
  ON CONFLICT (provider, provider_case_id) DO UPDATE
  SET status = EXCLUDED.status,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = now()
  RETURNING id INTO v_case_id;

  IF p_status IN ('opened', 'evidence_due', 'lost') THEN
    SELECT count(*) INTO v_count
    FROM public.payment_capture_allocations
    WHERE capture_id = v_capture.id
      AND amount_minor > 0;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'chargeback capture has no child allocations';
    END IF;

    FOR v_allocation IN
      SELECT *
      FROM public.payment_capture_allocations
      WHERE capture_id = v_capture.id
        AND amount_minor > 0
      ORDER BY order_id
    LOOP
      v_index := v_index + 1;
      v_amount := CASE
        WHEN v_index = v_count THEN p_amount_minor - v_allocated
        ELSE floor(
          p_amount_minor::numeric
          * v_allocation.amount_minor::numeric
          / v_capture.amount_minor::numeric
        )::bigint
      END;
      IF v_amount <= 0 THEN
        CONTINUE;
      END IF;
      v_allocated := v_allocated + v_amount;
      INSERT INTO public.chargeback_allocations (
        chargeback_id, order_id, seller_id, amount_minor
      ) VALUES (
        v_case_id, v_allocation.order_id, v_allocation.seller_id, v_amount
      )
      ON CONFLICT (chargeback_id, order_id) DO NOTHING;

      INSERT INTO public.seller_liability_entries (
        seller_id, entry_type, amount_minor, reference_type, reference_id,
        idempotency_key, metadata
      ) VALUES (
        v_allocation.seller_id, 'chargeback', v_amount,
        'chargeback', v_case_id::text,
        'seller-chargeback-liability:' || p_provider || ':'
          || p_provider_case_id || ':' || v_allocation.order_id::text,
        jsonb_build_object('order_id', v_allocation.order_id)
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END LOOP;

    PERFORM finance.post_journal(
      'CHARGEBACK_OPENED', 'chargeback', v_case_id::text,
      'chargeback-opened:' || p_provider || ':' || p_provider_case_id,
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'chargeback_receivable', 'direction', 'debit',
          'amount_minor', p_amount_minor,
          'metadata', jsonb_build_object(
            'provider_payment_id', p_provider_payment_id
          )
        ),
        jsonb_build_object(
          'account_code', 'gateway_clearing', 'direction', 'credit',
          'amount_minor', p_amount_minor,
          'metadata', jsonb_build_object(
            'provider_payment_id', p_provider_payment_id
          )
        )
      ),
      'Provider chargeback opened',
      jsonb_build_object(
        'provider', p_provider,
        'provider_case_id', p_provider_case_id
      ),
      now(), NULL
    );
  ELSIF p_status IN ('won', 'reversed') THEN
    INSERT INTO public.seller_liability_entries (
      seller_id, entry_type, amount_minor, reference_type, reference_id,
      idempotency_key, reverses_entry_id, metadata
    )
    SELECT
      e.seller_id, 'reversal', -e.amount_minor, 'chargeback', v_case_id::text,
      'seller-chargeback-liability-reversal:' || e.id::text,
      e.id, jsonb_build_object('provider_case_id', p_provider_case_id)
    FROM public.seller_liability_entries e
    WHERE e.reference_type = 'chargeback'
      AND e.reference_id = v_case_id::text
      AND e.entry_type = 'chargeback'
    ON CONFLICT (idempotency_key) DO NOTHING;

    PERFORM finance.reverse_posted_journal(
      (
        SELECT id
        FROM finance.ledger_transactions
        WHERE idempotency_key =
          'chargeback-opened:' || p_provider || ':' || p_provider_case_id
      ),
      'chargeback-reversal:' || p_provider || ':' || p_provider_case_id,
      'Provider chargeback won or reversed'
    );
  END IF;
  RETURN v_case_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_provider_chargeback(
  text, text, text, bigint, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_provider_chargeback(
  text, text, text, bigint, text, jsonb
) TO service_role;

COMMIT;
