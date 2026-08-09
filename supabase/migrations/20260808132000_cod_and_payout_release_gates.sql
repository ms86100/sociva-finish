-- COD is a collection rail, not proof of platform-held seller funds.
-- Payout state transitions are database-gated and journaled.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery_impl(
  p_old orders,
  p_new orders
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_cooldown_hours integer;
  v_platform_fee numeric;
  v_loyalty_subsidy numeric;
  v_wallet_cash numeric;
  v_wallet_promo numeric;
  v_gross numeric;
  v_society_id uuid;
BEGIN
  IF p_old.status IS NOT DISTINCT FROM p_new.status
     OR p_new.status NOT IN ('delivered', 'completed') THEN
    RETURN;
  END IF;

  -- Seller/courier-collected COD has no platform capture and therefore cannot
  -- create online seller payable. It remains in cod_transactions until an
  -- approved collection/reconciliation workflow posts it.
  IF lower(COALESCE(p_new.payment_type, '')) IN (
    'cod', 'cash', 'cash_on_delivery'
  ) THEN
    RETURN;
  END IF;
  IF p_new.payment_status IS DISTINCT FROM 'paid' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_capture_allocations a
    JOIN public.payment_captures c ON c.id = a.capture_id
    WHERE a.order_id = p_new.id
      AND c.status = 'captured'
      AND a.amount_minor = round(COALESCE(p_new.total_amount, 0) * 100)::bigint
  ) THEN
    RAISE WARNING
      'settlement skipped: paid order % has no complete captured allocation',
      p_new.id;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.seller_settlements WHERE order_id = p_new.id
  ) THEN
    RETURN;
  END IF;

  SELECT COALESCE(value::integer, 48)
  INTO v_cooldown_hours
  FROM public.system_settings
  WHERE key = 'settlement_cooldown_hours';
  v_cooldown_hours := COALESCE(v_cooldown_hours, 48);

  SELECT COALESCE(platform_fee, 0)
  INTO v_platform_fee
  FROM public.payment_records
  WHERE order_id = p_new.id
  LIMIT 1;
  v_platform_fee := COALESCE(v_platform_fee, 0);
  v_loyalty_subsidy := COALESCE(p_new.loyalty_discount_amount, 0);
  v_wallet_cash := COALESCE(p_new.wallet_cash_amount, 0);
  v_wallet_promo := COALESCE(p_new.wallet_promo_amount, 0);
  v_gross := COALESCE(p_new.total_amount, 0)
    + v_loyalty_subsidy + v_wallet_cash + v_wallet_promo;
  SELECT society_id INTO v_society_id
  FROM public.profiles
  WHERE id = p_new.buyer_id;

  INSERT INTO public.seller_settlements (
    order_id, seller_id, society_id,
    gross_amount, platform_fee, delivery_fee_share, net_amount,
    platform_loyalty_subsidy, gross_before_loyalty,
    wallet_cash_applied, wallet_promo_applied,
    settlement_status, eligible_at
  ) VALUES (
    p_new.id, p_new.seller_id, COALESCE(v_society_id, p_new.buyer_society_id),
    v_gross, v_platform_fee, COALESCE(p_new.delivery_fee, 0),
    v_gross - v_platform_fee,
    v_loyalty_subsidy, COALESCE(p_new.total_amount, 0) + v_loyalty_subsidy,
    v_wallet_cash, v_wallet_promo,
    'pending', now() + make_interval(hours => v_cooldown_hours)
  );
END;
$$;

CREATE OR REPLACE FUNCTION finance.enforce_payout_release_prerequisites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_capture public.payment_captures%ROWTYPE;
  v_destination public.seller_payout_destinations%ROWTYPE;
BEGIN
  IF NEW.settlement_status NOT IN ('eligible', 'processing', 'settled')
     OR NEW.settlement_status IS NOT DISTINCT FROM OLD.settlement_status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;
  IF NOT FOUND OR v_order.payment_status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'payout blocked: order payment is not paid';
  END IF;
  IF NEW.eligible_at IS NULL OR NEW.eligible_at > now() THEN
    RAISE EXCEPTION 'payout blocked: settlement cooling period not complete';
  END IF;
  IF lower(COALESCE(v_order.payment_type, '')) IN (
    'cod', 'cash', 'cash_on_delivery'
  ) THEN
    RAISE EXCEPTION 'payout blocked: COD is not platform-held online tender';
  END IF;

  SELECT c.* INTO v_capture
  FROM public.payment_capture_allocations a
  JOIN public.payment_captures c ON c.id = a.capture_id
  WHERE a.order_id = NEW.order_id
    AND c.status = 'captured'
    AND a.amount_minor = round(COALESCE(v_order.total_amount, 0) * 100)::bigint
  FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout blocked: complete captured allocation required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM finance.capture_allocation_variances v
    WHERE v.capture_id = v_capture.id
      AND v.difference_minor = 0
  ) THEN
    RAISE EXCEPTION 'payout blocked: capture allocation variance';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_reconciliation_records r
    WHERE r.provider = v_capture.provider
      AND r.reference_type = 'payment_capture'
      AND r.reference_id = v_capture.provider_payment_id
      AND r.status = 'matched'
      AND r.difference_minor = 0
  ) THEN
    RAISE EXCEPTION 'payout blocked: clean internal allocation reconciliation required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_reconciliation_records r
    WHERE r.provider = v_capture.provider
      AND r.reference_type = 'provider_payment'
      AND r.reference_id = v_capture.provider_payment_id
      AND r.status = 'matched'
      AND r.difference_minor = 0
      AND NULLIF(r.metadata->>'provider_statement_row_id', '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'payout blocked: exact external provider statement required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.refund_requests r
    WHERE r.order_id = NEW.order_id
      AND r.refund_state IN (
        'approved', 'refund_initiated', 'refund_processing',
        'needs_manual_review', 'refund_completed'
      )
  ) THEN
    RAISE EXCEPTION 'payout blocked: refund conflict';
  END IF;

  SELECT * INTO v_destination
  FROM public.seller_payout_destinations
  WHERE seller_id = NEW.seller_id
    AND provider = 'razorpay_route'
    AND verification_status = 'verified'
    AND active
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout blocked: verified destination required';
  END IF;
  IF v_destination.cooling_until IS NOT NULL
     AND v_destination.cooling_until > now() THEN
    RAISE EXCEPTION 'payout blocked: destination cooling period';
  END IF;
  IF NOT COALESCE((
    SELECT enabled FROM public.financial_feature_flags
    WHERE key = 'seller_payout_enabled'
  ), false) OR COALESCE((
    SELECT value FROM public.financial_configuration
    WHERE key = 'provider_payout_mode'
  ), 'disabled') <> 'razorpay_route_deferred' THEN
    RAISE EXCEPTION 'payout blocked: money movement gate disabled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_payout_release_prerequisites
  ON public.seller_settlements;
CREATE TRIGGER trg_enforce_payout_release_prerequisites
BEFORE UPDATE OF settlement_status ON public.seller_settlements
FOR EACH ROW EXECUTE FUNCTION finance.enforce_payout_release_prerequisites();

CREATE OR REPLACE FUNCTION finance.reverse_posted_journal(
  p_original_transaction_id uuid,
  p_idempotency_key text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_original finance.ledger_transactions%ROWTYPE;
  v_entries jsonb;
BEGIN
  SELECT * INTO v_original
  FROM finance.ledger_transactions
  WHERE id = p_original_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR v_original.posted_at IS NULL THEN
    RAISE EXCEPTION 'only a posted journal can be reversed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM finance.ledger_transactions
    WHERE reverses_transaction_id = p_original_transaction_id
      AND posted_at IS NOT NULL
  ) THEN
    SELECT id
    INTO p_original_transaction_id
    FROM finance.ledger_transactions
    WHERE reverses_transaction_id = v_original.id
      AND posted_at IS NOT NULL
    LIMIT 1;
    RETURN p_original_transaction_id;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'account_code', a.code,
    'direction', CASE e.direction WHEN 'debit' THEN 'credit' ELSE 'debit' END,
    'amount_minor', e.amount_minor,
    'order_id', e.order_id,
    'payment_record_id', e.payment_record_id,
    'refund_id', e.refund_id,
    'settlement_id', e.settlement_id,
    'metadata', e.metadata
  ) ORDER BY e.id)
  INTO v_entries
  FROM finance.ledger_entries e
  JOIN finance.ledger_accounts a ON a.id = e.account_id
  WHERE e.transaction_id = v_original.id;

  RETURN finance.post_journal(
    'REVERSAL', v_original.reference_type, v_original.reference_id,
    p_idempotency_key, v_entries, p_reason,
    jsonb_build_object('reverses_transaction_id', v_original.id),
    now(), v_original.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION finance.post_payout_attempt_journal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_settlement public.seller_settlements%ROWTYPE;
  v_reservation_id uuid;
BEGIN
  SELECT * INTO v_settlement
  FROM public.seller_settlements
  WHERE id = NEW.settlement_id;

  IF TG_OP = 'INSERT' THEN
    PERFORM finance.post_journal(
      'PAYOUT_RESERVED', 'payout_attempt', NEW.id::text,
      'payout-reserve:' || NEW.id::text,
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'seller_payable_available', 'direction', 'debit',
          'amount_minor', NEW.amount_minor, 'settlement_id', NEW.settlement_id,
          'order_id', v_settlement.order_id,
          'metadata', jsonb_build_object('seller_id', v_settlement.seller_id)
        ),
        jsonb_build_object(
          'account_code', 'settlement_in_transit', 'direction', 'credit',
          'amount_minor', NEW.amount_minor, 'settlement_id', NEW.settlement_id,
          'order_id', v_settlement.order_id,
          'metadata', jsonb_build_object('seller_id', v_settlement.seller_id)
        )
      ),
      'Seller payout reserved before provider transfer',
      jsonb_build_object('payout_attempt_id', NEW.id),
      now(), NULL
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'failed' THEN
    SELECT id INTO v_reservation_id
    FROM finance.ledger_transactions
    WHERE idempotency_key = 'payout-reserve:' || NEW.id::text;
    PERFORM finance.reverse_posted_journal(
      v_reservation_id,
      'payout-reserve-reversal:' || NEW.id::text,
      'Exact reversal of failed seller payout reservation'
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'succeeded' THEN
    PERFORM finance.post_journal(
      'PAYOUT_SUCCEEDED', 'payout_attempt', NEW.id::text,
      'payout-success:' || NEW.id::text,
      jsonb_build_array(
        jsonb_build_object(
          'account_code', 'settlement_in_transit', 'direction', 'debit',
          'amount_minor', NEW.amount_minor, 'settlement_id', NEW.settlement_id,
          'order_id', v_settlement.order_id
        ),
        jsonb_build_object(
          'account_code', 'cash_at_bank', 'direction', 'credit',
          'amount_minor', NEW.amount_minor, 'settlement_id', NEW.settlement_id,
          'order_id', v_settlement.order_id
        )
      ),
      'Provider-confirmed seller payout',
      jsonb_build_object(
        'payout_attempt_id', NEW.id,
        'provider_transfer_id', NEW.provider_transfer_id
      ),
      now(), NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_payout_attempt_journal
  ON public.payout_attempts;
CREATE TRIGGER trg_post_payout_attempt_journal
AFTER INSERT OR UPDATE OF status ON public.payout_attempts
FOR EACH ROW EXECUTE FUNCTION finance.post_payout_attempt_journal();

COMMIT;
