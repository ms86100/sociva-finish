-- SOCIVA financial operations and controlled rollout
-- Depends on 20260808055445_wallet_financial_hardening.sql.

BEGIN;

ALTER TABLE public.wallet_reservations
  ADD COLUMN IF NOT EXISTS requested_amount numeric(14,2);
ALTER TABLE public.financial_reconciliation_records
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE public.wallet_reservations
SET requested_amount = round(cash_amount + promo_amount, 2)
WHERE requested_amount IS NULL;

CREATE OR REPLACE FUNCTION public.reserve_wallet_credit(
  _amount numeric,
  _idempotency_key text DEFAULT NULL,
  _checkout_key text DEFAULT NULL,
  _order_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  w public.buyer_wallets;
  r public.wallet_reservations;
  _plan jsonb;
  _cash numeric;
  _promo numeric;
  _total numeric;
  _txn_id uuid;
  _normalized_order_ids uuid[];
  _stored_order_ids uuid[];
  _requested numeric := round(COALESCE(_amount, 0), 2);
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF _requested <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'amount_must_be_positive');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
  INTO _normalized_order_ids
  FROM unnest(COALESCE(_order_ids, '{}'::uuid[])) id;

  IF _idempotency_key IS NOT NULL THEN
    IF length(_idempotency_key) < 12 THEN
      RETURN jsonb_build_object('success', false, 'error', 'idempotency_key_too_short');
    END IF;
    PERFORM pg_advisory_xact_lock(
      hashtextextended('wallet-reservation:' || _idempotency_key, 20260808)
    );
    SELECT * INTO r
    FROM public.wallet_reservations
    WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
      INTO _stored_order_ids
      FROM unnest(COALESCE(r.order_ids, '{}'::uuid[])) id;

      IF r.user_id IS DISTINCT FROM _uid
         OR round(COALESCE(r.requested_amount, r.cash_amount + r.promo_amount), 2)
            IS DISTINCT FROM _requested
         OR r.checkout_key IS DISTINCT FROM _checkout_key
         OR _stored_order_ids IS DISTINCT FROM _normalized_order_ids THEN
        RETURN jsonb_build_object(
          'success', false, 'error', 'idempotency_key_payload_mismatch'
        );
      END IF;
      RETURN jsonb_build_object(
        'success', true,
        'reservation_id', r.id,
        'cash_amount', r.cash_amount,
        'promo_amount', r.promo_amount,
        'status', r.status,
        'deduplicated', true
      );
    END IF;
  END IF;

  PERFORM public.wallet_ensure_wallet(_uid);
  SELECT * INTO w
  FROM public.buyer_wallets
  WHERE user_id = _uid
  FOR UPDATE;
  IF w.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'wallet_frozen');
  END IF;

  _plan := public.wallet_plan_spend(
    w.cash_available, w.promo_available, _requested
  );
  _cash := (_plan->>'cash_amount')::numeric;
  _promo := (_plan->>'promo_amount')::numeric;
  _total := (_plan->>'total')::numeric;
  IF _total <= 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'insufficient_credit',
      'available', w.cash_available + w.promo_available
    );
  END IF;

  UPDATE public.buyer_wallets
  SET cash_available = cash_available - _cash,
      promo_available = promo_available - _promo,
      cash_pending = cash_pending + _cash,
      promo_pending = promo_pending + _promo,
      version = version + 1,
      updated_at = now()
  WHERE user_id = _uid
  RETURNING * INTO w;

  INSERT INTO public.wallet_reservations (
    user_id, order_ids, cash_amount, promo_amount, requested_amount,
    status, idempotency_key, checkout_key
  ) VALUES (
    _uid, _normalized_order_ids, _cash, _promo, _requested,
    'held', _idempotency_key, _checkout_key
  )
  RETURNING * INTO r;

  INSERT INTO public.wallet_ledger_txns (
    user_id, type, reference_type, reference_id, idempotency_key,
    description, created_by, metadata
  ) VALUES (
    _uid, 'spend_reserve', 'reservation', r.id::text,
    CASE WHEN _idempotency_key IS NULL
      THEN NULL ELSE 'wallet-reserve:' || _idempotency_key END,
    'Reserved Sociva Credit ₹' || _total::text,
    _uid,
    jsonb_build_object(
      'cash', _cash, 'promo', _promo, 'checkout_key', _checkout_key,
      'requested_amount', _requested, 'order_ids', _normalized_order_ids
    )
  )
  RETURNING id INTO _txn_id;

  IF _cash > 0 THEN
    PERFORM public.wallet_insert_entry(
      _txn_id, 'user_cash:' || _uid::text, 'debit', _cash, 'cash'
    );
    PERFORM public.wallet_insert_entry(
      _txn_id, 'user_cash_held:' || _uid::text, 'credit', _cash, 'cash'
    );
  END IF;
  IF _promo > 0 THEN
    PERFORM public.wallet_insert_entry(
      _txn_id, 'user_promo:' || _uid::text, 'debit', _promo, 'promo'
    );
    PERFORM public.wallet_insert_entry(
      _txn_id, 'user_promo_held:' || _uid::text, 'credit', _promo, 'promo'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'reservation_id', r.id,
    'cash_amount', _cash, 'promo_amount', _promo, 'total', _total,
    'status', 'held', 'cash_available', w.cash_available,
    'promo_available', w.promo_available
  );
END;
$$;

CREATE OR REPLACE FUNCTION finance.validate_wallet_reservation_commit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_old_orders uuid[];
  v_new_orders uuid[];
BEGIN
  IF NEW.status = 'committed' AND OLD.status IS DISTINCT FROM 'committed' THEN
    SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
    INTO v_old_orders
    FROM unnest(COALESCE(OLD.order_ids, '{}'::uuid[])) id;
    SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
    INTO v_new_orders
    FROM unnest(COALESCE(NEW.order_ids, '{}'::uuid[])) id;

    IF cardinality(v_new_orders) = 0 THEN
      RAISE EXCEPTION 'wallet reservation commit requires orders';
    END IF;
    IF cardinality(v_old_orders) > 0 AND v_old_orders IS DISTINCT FROM v_new_orders THEN
      RAISE EXCEPTION 'wallet reservation commit order payload mismatch';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(v_new_orders) requested(order_id)
      LEFT JOIN public.orders o ON o.id = requested.order_id
      WHERE o.id IS NULL OR o.buyer_id IS DISTINCT FROM NEW.user_id
    ) THEN
      RAISE EXCEPTION 'wallet reservation cannot fund another buyer orders';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_wallet_reservation_commit
  ON public.wallet_reservations;
CREATE TRIGGER trg_validate_wallet_reservation_commit
BEFORE UPDATE OF status, order_ids ON public.wallet_reservations
FOR EACH ROW EXECUTE FUNCTION finance.validate_wallet_reservation_commit();

CREATE TABLE IF NOT EXISTS public.financial_control_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_type text NOT NULL CHECK (control_type IN ('feature_flag', 'configuration')),
  control_key text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'cancelled')
  ),
  requested_by uuid NOT NULL,
  approved_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_control_pending
  ON public.financial_control_change_requests(control_type, control_key)
  WHERE status = 'pending';
ALTER TABLE public.financial_control_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view financial control requests"
  ON public.financial_control_change_requests FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.financial_control_change_requests
  FROM anon, authenticated;
GRANT SELECT ON public.financial_control_change_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_control_change_requests TO service_role;

CREATE OR REPLACE FUNCTION finance.guard_financial_control_enable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'financial_feature_flags' THEN
    IF COALESCE(OLD.enabled, false) = false
       AND NEW.enabled = true
       AND COALESCE(
         current_setting('app.financial_control_approved', true), ''
       ) <> 'true' THEN
      RAISE EXCEPTION 'financial feature enable requires approved maker-checker request';
    END IF;
    IF COALESCE(OLD.enabled, false) = false
       AND NEW.enabled = true
       AND NEW.key IN ('ledger_read_projection', 'seller_payout_enabled')
       AND (
         EXISTS (
           SELECT 1
           FROM public.financial_reconciliation_records
           WHERE status IN ('open', 'investigating')
         )
         OR EXISTS (SELECT 1 FROM finance.journal_integrity_violations)
         OR EXISTS (
           SELECT 1
           FROM public.financial_backfill_candidates
           WHERE confidence = 'ambiguous'
             AND review_status IN ('pending', 'approved')
         )
       ) THEN
      RAISE EXCEPTION
        'financial read/payout enable requires zero unresolved reconciliation and opening differences';
    END IF;
  ELSIF TG_TABLE_NAME = 'financial_configuration' THEN
    IF OLD.value = 'disabled'
       AND NEW.value <> 'disabled'
       AND COALESCE(
         current_setting('app.financial_control_approved', true), ''
       ) <> 'true' THEN
      RAISE EXCEPTION 'financial provider mode enable requires approved maker-checker request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_financial_feature_enable
  ON public.financial_feature_flags;
CREATE TRIGGER trg_guard_financial_feature_enable
BEFORE UPDATE ON public.financial_feature_flags
FOR EACH ROW EXECUTE FUNCTION finance.guard_financial_control_enable();

DROP TRIGGER IF EXISTS trg_guard_financial_configuration_enable
  ON public.financial_configuration;
CREATE TRIGGER trg_guard_financial_configuration_enable
BEFORE UPDATE ON public.financial_configuration
FOR EACH ROW EXECUTE FUNCTION finance.guard_financial_control_enable();

CREATE OR REPLACE FUNCTION finance.enforce_refund_destination_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_enabled boolean;
  v_payment_type text;
  v_provider_payment_id text;
BEGIN
  IF NEW.refund_destination = 'wallet'
     AND (
       TG_OP = 'INSERT'
       OR NEW.refund_destination IS DISTINCT FROM OLD.refund_destination
     ) THEN
    SELECT enabled INTO v_enabled
    FROM public.financial_feature_flags
    WHERE key = 'wallet_refund_credit_enabled';
    IF COALESCE(v_enabled, false) = false THEN
      SELECT lower(COALESCE(o.payment_type, '')),
             COALESCE(o.razorpay_payment_id, cg.razorpay_payment_id)
      INTO v_payment_type, v_provider_payment_id
      FROM public.orders o
      LEFT JOIN public.checkout_groups cg ON cg.id = o.checkout_group_id
      WHERE o.id = NEW.order_id;

      IF v_payment_type IN ('cod', 'cash')
         OR NULLIF(v_provider_payment_id, '') IS NULL THEN
        -- No provider rail exists to refund. Preserve the cancellation/refund
        -- evidence, but do not invent SOCIVA Credit while that product is off.
        NEW.refund_state := 'needs_manual_review';
        NEW.status := 'pending';
        NEW.auto_approved := false;
        NEW.wallet_credit_amount := NULL;
      ELSE
        RAISE EXCEPTION 'wallet refund credit is disabled';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_refund_destination_switch
  ON public.refund_requests;
CREATE TRIGGER trg_enforce_refund_destination_switch
BEFORE INSERT OR UPDATE OF refund_destination ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION finance.enforce_refund_destination_switch();

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
    SELECT s.settlement_status INTO v_settlement_status
    FROM public.seller_settlements s
    WHERE s.order_id = NEW.order_id
    FOR UPDATE;
    IF v_settlement_status = 'processing' THEN
      RAISE EXCEPTION 'refund cannot be approved while seller payout is processing';
    END IF;
    IF v_settlement_status = 'settled' THEN
      RAISE EXCEPTION 'post-payout refund requires controlled seller liability review';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_financial_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  SELECT jsonb_build_object(
    'wallet_refund_credit_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_refund_credit_enabled'
    ), false),
    'wallet_spend_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'wallet_spend_enabled'
    ), false),
    'seller_payout_enabled', COALESCE(bool_or(enabled) FILTER (
      WHERE key = 'seller_payout_enabled'
    ), false)
  )
  INTO v_result
  FROM public.financial_feature_flags;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_financial_capabilities()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_capabilities()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_refund_by_gateway_id(
  p_gateway_refund_id text,
  p_gateway_status text DEFAULT 'processed',
  p_razorpay_payment_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  r public.refund_requests;
  v_completed public.refund_requests;
BEGIN
  IF p_gateway_refund_id IS NULL OR length(btrim(p_gateway_refund_id)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_gateway_refund_id');
  END IF;
  IF lower(COALESCE(p_gateway_status, '')) <> 'processed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_not_provider_processed');
  END IF;
  IF p_razorpay_payment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_provider_payment_id');
  END IF;

  SELECT rr.* INTO r
  FROM public.refund_requests rr
  JOIN public.refund_attempts ra ON ra.refund_id = rr.id
  WHERE rr.gateway_refund_id = p_gateway_refund_id
    AND ra.provider = 'razorpay'
    AND ra.provider_refund_id = p_gateway_refund_id
    AND ra.provider_payment_id = p_razorpay_payment_id
    AND ra.status = 'succeeded'
  ORDER BY ra.created_at DESC
  LIMIT 1
  FOR UPDATE OF rr;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'exact_refund_attempt_not_found'
    );
  END IF;
  IF r.refund_state = 'refund_completed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'refund_id', r.id
    );
  END IF;
  IF r.refund_state NOT IN (
    'approved', 'refund_initiated', 'refund_processing', 'needs_manual_review'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'invalid_refund_state', 'state', r.refund_state
    );
  END IF;

  IF r.refund_state IN ('approved', 'needs_manual_review') THEN
    UPDATE public.refund_requests
    SET refund_state = 'refund_initiated',
        status = 'processing',
        gateway_status = p_gateway_status,
        updated_at = now()
    WHERE id = r.id;
  END IF;

  v_completed := public.complete_refund(
    r.id, p_gateway_refund_id, p_gateway_status
  );
  RETURN jsonb_build_object(
    'ok', true, 'matched', true, 'refund_id', v_completed.id,
    'refund_state', v_completed.refund_state
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_refund_by_gateway_id(
  text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_refund_by_gateway_id(
  text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.request_financial_control_change(
  p_control_type text,
  p_control_key text,
  p_new_value text,
  p_reason text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_old_value text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF p_control_type = 'feature_flag' THEN
    SELECT enabled::text INTO v_old_value
    FROM public.financial_feature_flags
    WHERE key = p_control_key;
  ELSIF p_control_type = 'configuration' THEN
    SELECT value INTO v_old_value
    FROM public.financial_configuration
    WHERE key = p_control_key;
  ELSE
    RAISE EXCEPTION 'unsupported control type';
  END IF;
  IF v_old_value IS NULL THEN
    RAISE EXCEPTION 'unknown financial control';
  END IF;

  INSERT INTO public.financial_control_change_requests (
    control_type, control_key, old_value, new_value, reason,
    requested_by, expires_at
  ) VALUES (
    p_control_type, p_control_key, v_old_value, p_new_value, p_reason,
    auth.uid(), p_expires_at
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_type, target_id, metadata
  ) VALUES (
    auth.uid(), 'financial_control_change_requested',
    'financial_control_change_request', v_id,
    jsonb_build_object(
      'control_type', p_control_type,
      'control_key', p_control_key,
      'old_value', v_old_value,
      'new_value', p_new_value,
      'reason', p_reason
    )
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_financial_control_change(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_request public.financial_control_change_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  SELECT * INTO v_request
  FROM public.financial_control_change_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'pending request not found';
  END IF;
  IF v_request.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'maker cannot approve own financial control change';
  END IF;
  IF v_request.expires_at IS NOT NULL AND v_request.expires_at <= now() THEN
    RAISE EXCEPTION 'financial control request expired';
  END IF;

  PERFORM set_config('app.financial_control_approved', 'true', true);
  IF v_request.control_type = 'feature_flag' THEN
    IF lower(v_request.new_value) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'feature flag value must be true or false';
    END IF;
    UPDATE public.financial_feature_flags
    SET enabled = v_request.new_value::boolean,
        updated_by = auth.uid(),
        updated_at = now()
    WHERE key = v_request.control_key;
  ELSE
    IF v_request.control_key = 'provider_payout_mode'
       AND v_request.new_value NOT IN ('disabled', 'razorpay_route_deferred') THEN
      RAISE EXCEPTION 'unsupported payout provider mode';
    END IF;
    UPDATE public.financial_configuration
    SET value = v_request.new_value,
        updated_by = auth.uid(),
        updated_at = now()
    WHERE key = v_request.control_key;
  END IF;

  UPDATE public.financial_control_change_requests
  SET status = 'approved',
      approved_by = auth.uid(),
      decided_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_type, target_id, metadata
  ) VALUES (
    auth.uid(), 'financial_control_change_approved',
    'financial_control_change_request', p_request_id,
    jsonb_build_object(
      'maker', v_request.requested_by,
      'control_type', v_request.control_type,
      'control_key', v_request.control_key,
      'old_value', v_request.old_value,
      'new_value', v_request.new_value,
      'reason', v_request.reason
    )
  );
  RETURN jsonb_build_object('approved', true, 'request_id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_financial_control_change(
  text, text, text, text, timestamptz
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_financial_control_change(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_financial_control_change(
  text, text, text, text, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_financial_control_change(uuid)
  TO authenticated;

CREATE TABLE IF NOT EXISTS public.financial_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  entries jsonb NOT NULL CHECK (
    jsonb_typeof(entries) = 'array' AND jsonb_array_length(entries) >= 2
  ),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 20),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'posted')
  ),
  requested_by uuid NOT NULL,
  approved_by uuid,
  journal_transaction_id uuid REFERENCES finance.ledger_transactions(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
ALTER TABLE public.financial_adjustment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view financial adjustment requests"
  ON public.financial_adjustment_requests FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.financial_adjustment_requests
  FROM anon, authenticated;
GRANT SELECT ON public.financial_adjustment_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_adjustment_requests TO service_role;

CREATE OR REPLACE FUNCTION public.request_financial_adjustment(
  p_reference_type text,
  p_reference_id text,
  p_entries jsonb,
  p_reason text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  INSERT INTO public.financial_adjustment_requests (
    reference_type, reference_id, entries, reason, requested_by, metadata
  ) VALUES (
    p_reference_type, p_reference_id, p_entries, p_reason, auth.uid(),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_financial_adjustment(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_request public.financial_adjustment_requests%ROWTYPE;
  v_journal_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  SELECT * INTO v_request
  FROM public.financial_adjustment_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'pending adjustment not found';
  END IF;
  IF v_request.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'maker cannot approve own financial adjustment';
  END IF;

  v_journal_id := finance.post_journal(
    'ADJUSTMENT',
    v_request.reference_type,
    v_request.reference_id,
    'financial-adjustment:' || v_request.id::text,
    v_request.entries,
    v_request.reason,
    v_request.metadata || jsonb_build_object(
      'request_id', v_request.id,
      'maker', v_request.requested_by,
      'checker', auth.uid()
    ),
    now(),
    NULL
  );

  UPDATE public.financial_adjustment_requests
  SET status = 'posted',
      approved_by = auth.uid(),
      journal_transaction_id = v_journal_id,
      decided_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_log (
    actor_id, action, target_type, target_id, metadata
  ) VALUES (
    auth.uid(), 'financial_adjustment_posted',
    'financial_adjustment_request', p_request_id,
    jsonb_build_object(
      'journal_transaction_id', v_journal_id,
      'maker', v_request.requested_by,
      'reason', v_request.reason
    )
  );
  RETURN jsonb_build_object(
    'posted', true,
    'request_id', p_request_id,
    'journal_transaction_id', v_journal_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_financial_adjustment(
  text, text, jsonb, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_financial_adjustment(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_financial_adjustment(
  text, text, jsonb, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_financial_adjustment(uuid)
  TO authenticated;

CREATE TABLE IF NOT EXISTS public.seller_payout_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id),
  destination_type text NOT NULL CHECK (
    destination_type IN ('razorpay_linked_account', 'bank', 'upi')
  ),
  provider text NOT NULL,
  provider_reference text NOT NULL,
  masked_label text NOT NULL,
  verification_status text NOT NULL CHECK (
    verification_status IN ('pending', 'verified', 'failed', 'disabled')
  ),
  active boolean NOT NULL DEFAULT false,
  cooling_until timestamptz,
  verified_at timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_seller_payout_destination
  ON public.seller_payout_destinations(seller_id)
  WHERE active;
ALTER TABLE public.seller_payout_destinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sellers can view own masked payout destinations"
  ON public.seller_payout_destinations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.id = seller_id AND sp.user_id = auth.uid()
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.seller_payout_destinations
  FROM anon, authenticated;
GRANT SELECT ON public.seller_payout_destinations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.seller_payout_destinations TO service_role;

CREATE TABLE IF NOT EXISTS public.payout_limit_policies (
  id text PRIMARY KEY,
  min_amount_minor bigint NOT NULL CHECK (min_amount_minor > 0),
  max_amount_minor bigint NOT NULL CHECK (max_amount_minor >= min_amount_minor),
  daily_amount_minor bigint NOT NULL CHECK (daily_amount_minor >= max_amount_minor),
  weekly_amount_minor bigint NOT NULL CHECK (weekly_amount_minor >= daily_amount_minor),
  monthly_amount_minor bigint NOT NULL CHECK (monthly_amount_minor >= weekly_amount_minor),
  max_pending integer NOT NULL CHECK (max_pending > 0),
  destination_cooling_hours integer NOT NULL CHECK (destination_cooling_hours >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.payout_limit_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_limit_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payout_limit_policies TO service_role;
INSERT INTO public.payout_limit_policies (
  id, min_amount_minor, max_amount_minor, daily_amount_minor,
  weekly_amount_minor, monthly_amount_minor, max_pending,
  destination_cooling_hours
) VALUES (
  'default', 10000, 10000000, 25000000, 100000000, 300000000, 3, 24
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payout_attempts
  ADD COLUMN IF NOT EXISTS destination_id uuid
  REFERENCES public.seller_payout_destinations(id);

CREATE OR REPLACE FUNCTION finance.guard_payout_attempt_terminal_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'succeeded'
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.destination_id IS DISTINCT FROM OLD.destination_id
     ) THEN
    RAISE EXCEPTION 'succeeded payout attempt is immutable';
  END IF;
  IF OLD.provider_transfer_id IS NOT NULL
     AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id THEN
    RAISE EXCEPTION 'payout provider transfer identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payout_attempt_terminal_state
  ON public.payout_attempts;
CREATE TRIGGER trg_guard_payout_attempt_terminal_state
BEFORE UPDATE ON public.payout_attempts
FOR EACH ROW EXECUTE FUNCTION finance.guard_payout_attempt_terminal_state();

CREATE OR REPLACE FUNCTION finance.register_verified_payout_destination(
  p_seller_id uuid,
  p_destination_type text,
  p_provider text,
  p_provider_reference text,
  p_masked_label text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
DECLARE
  v_cooling_hours integer;
  v_id uuid;
BEGIN
  SELECT destination_cooling_hours INTO v_cooling_hours
  FROM public.payout_limit_policies
  WHERE id = 'default';

  UPDATE public.seller_payout_destinations
  SET active = false,
      verification_status = CASE
        WHEN verification_status = 'verified' THEN 'disabled'
        ELSE verification_status
      END,
      updated_at = now()
  WHERE seller_id = p_seller_id
    AND active;

  INSERT INTO public.seller_payout_destinations (
    seller_id, destination_type, provider, provider_reference,
    masked_label, verification_status, active, cooling_until, verified_at
  ) VALUES (
    p_seller_id, p_destination_type, p_provider, p_provider_reference,
    p_masked_label, 'verified', true,
    now() + make_interval(hours => COALESCE(v_cooling_hours, 24)),
    now()
  )
  ON CONFLICT (provider, provider_reference) DO UPDATE
  SET seller_id = EXCLUDED.seller_id,
      destination_type = EXCLUDED.destination_type,
      masked_label = EXCLUDED.masked_label,
      verification_status = 'verified',
      active = true,
      cooling_until = EXCLUDED.cooling_until,
      verified_at = now(),
      changed_at = now(),
      updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_verified_payout_destination(
  p_seller_id uuid,
  p_destination_type text,
  p_provider text,
  p_provider_reference text,
  p_masked_label text
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path = finance, public, pg_temp
AS $$
  SELECT finance.register_verified_payout_destination(
    p_seller_id, p_destination_type, p_provider,
    p_provider_reference, p_masked_label
  );
$$;
REVOKE ALL ON FUNCTION public.register_verified_payout_destination(
  uuid, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_verified_payout_destination(
  uuid, text, text, text, text
) TO service_role;

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
  v_destination public.seller_payout_destinations%ROWTYPE;
  v_policy public.payout_limit_policies%ROWTYPE;
  v_pending integer;
  v_daily bigint;
  v_weekly bigint;
  v_monthly bigint;
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

  SELECT * INTO v_policy
  FROM public.payout_limit_policies
  WHERE id = 'default';
  IF p_amount_minor < v_policy.min_amount_minor
     OR p_amount_minor > v_policy.max_amount_minor THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'amount_outside_limits');
  END IF;

  SELECT * INTO v_destination
  FROM public.seller_payout_destinations
  WHERE seller_id = v_settlement.seller_id
    AND provider = 'razorpay_route'
    AND verification_status = 'verified'
    AND active
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'verified_destination_required');
  END IF;
  IF v_destination.cooling_until IS NOT NULL
     AND v_destination.cooling_until > now() THEN
    RETURN jsonb_build_object(
      'claimed', false, 'reason', 'destination_cooling_period',
      'cooling_until', v_destination.cooling_until
    );
  END IF;

  SELECT payment_status INTO v_order_payment_status
  FROM public.orders
  WHERE id = v_settlement.order_id
  FOR UPDATE;
  IF v_order_payment_status <> 'paid' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'payment_not_paid');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.refund_requests r
    WHERE r.order_id = v_settlement.order_id
      AND r.refund_state IN (
        'approved', 'refund_initiated', 'refund_processing',
        'needs_manual_review', 'refund_completed'
      )
  ) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'refund_exists');
  END IF;

  -- Serialize all payout claims for one seller so concurrent settlements cannot
  -- independently pass stale daily/weekly/monthly and pending-attempt totals.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_settlement.seller_id::text, 20260808)
  );

  SELECT
    count(*) FILTER (
      WHERE pa.status IN ('processing', 'reconciliation_required')
    )::integer,
    COALESCE(sum(pa.amount_minor) FILTER (
      WHERE pa.created_at >= date_trunc('day', now())
        AND pa.status IN ('processing', 'succeeded', 'reconciliation_required')
    ), 0)::bigint,
    COALESCE(sum(pa.amount_minor) FILTER (
      WHERE pa.created_at >= date_trunc('week', now())
        AND pa.status IN ('processing', 'succeeded', 'reconciliation_required')
    ), 0)::bigint,
    COALESCE(sum(pa.amount_minor) FILTER (
      WHERE pa.created_at >= date_trunc('month', now())
        AND pa.status IN ('processing', 'succeeded', 'reconciliation_required')
    ), 0)::bigint
  INTO v_pending, v_daily, v_weekly, v_monthly
  FROM public.payout_attempts pa
  JOIN public.seller_settlements s ON s.id = pa.settlement_id
  WHERE s.seller_id = v_settlement.seller_id;

  IF v_pending >= v_policy.max_pending
     OR v_daily + p_amount_minor > v_policy.daily_amount_minor
     OR v_weekly + p_amount_minor > v_policy.weekly_amount_minor
     OR v_monthly + p_amount_minor > v_policy.monthly_amount_minor THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'payout_limit_exceeded');
  END IF;

  INSERT INTO public.payout_attempts (
    settlement_id, provider, request_key, amount_minor, status, destination_id
  ) VALUES (
    p_settlement_id, 'razorpay_route', p_request_key,
    p_amount_minor, 'processing', v_destination.id
  )
  RETURNING id INTO v_attempt_id;

  UPDATE public.seller_settlements
  SET settlement_status = 'processing',
      updated_at = now()
  WHERE id = p_settlement_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'attempt_id', v_attempt_id,
    'destination_id', v_destination.id,
    'destination_provider_reference', v_destination.provider_reference
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'attempt_exists');
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
  IF v_attempt.status = 'succeeded' THEN
    RETURN jsonb_build_object(
      'held', false, 'reason', 'terminal_succeeded_attempt'
    );
  END IF;
  IF v_attempt.status = 'failed' AND NOT p_unknown THEN
    RETURN jsonb_build_object(
      'held', true, 'deduplicated', true,
      'settlement_id', v_attempt.settlement_id
    );
  END IF;
  IF v_attempt.status NOT IN ('processing', 'reconciliation_required') THEN
    RETURN jsonb_build_object(
      'held', false, 'reason', 'attempt_not_holdable',
      'status', v_attempt.status
    );
  END IF;
  IF v_attempt.provider_transfer_id IS NOT NULL
     AND p_provider_transfer_id IS NOT NULL
     AND v_attempt.provider_transfer_id <> p_provider_transfer_id THEN
    RAISE EXCEPTION 'provider transfer identity mismatch';
  END IF;

  UPDATE public.payout_attempts
  SET status = CASE
        WHEN p_unknown THEN 'reconciliation_required' ELSE 'failed'
      END,
      provider_transfer_id = COALESCE(
        p_provider_transfer_id, provider_transfer_id
      ),
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

  RETURN jsonb_build_object(
    'held', true, 'settlement_id', v_attempt.settlement_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_financial_summary(
  p_seller_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RAISE EXCEPTION 'seller ids required';
  END IF;
  IF NOT public.is_admin(auth.uid()) AND EXISTS (
    SELECT 1
    FROM unnest(p_seller_ids) requested(id)
    LEFT JOIN public.seller_profiles sp
      ON sp.id = requested.id AND sp.user_id = auth.uid()
    WHERE sp.id IS NULL
  ) THEN
    RAISE EXCEPTION 'seller scope forbidden';
  END IF;

  SELECT jsonb_build_object(
    'pending', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'pending'
    ), 0),
    'available', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'eligible'
    ), 0),
    'reserved', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'processing'
    ), 0),
    'on_hold', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'on_hold'
    ), 0),
    'paid_out', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'settled'
        AND s.razorpay_transfer_id IS NOT NULL
    ), 0),
    'legacy_settled_unverified', COALESCE(sum(s.net_amount) FILTER (
      WHERE s.settlement_status = 'settled'
        AND s.razorpay_transfer_id IS NULL
    ), 0),
    'refunded', COALESCE((
      SELECT sum(r.amount)
      FROM public.refund_requests r
      WHERE r.seller_id = ANY(p_seller_ids)
        AND r.refund_state = 'refund_completed'
    ), 0),
    'cod_expected', COALESCE((
      SELECT sum(c.expected_amount_minor)::numeric / 100
      FROM public.cod_transactions c
      WHERE c.seller_id = ANY(p_seller_ids)
        AND c.status IN ('expected', 'not_received', 'disputed')
    ), 0),
    'cod_collected', COALESCE((
      SELECT sum(c.collected_amount_minor)::numeric / 100
      FROM public.cod_transactions c
      WHERE c.seller_id = ANY(p_seller_ids)
        AND c.status IN ('collected', 'confirmed', 'reconciled')
    ), 0),
    'currency', 'INR',
    'as_of', now()
  )
  INTO v_result
  FROM public.seller_settlements s
  WHERE s.seller_id = ANY(p_seller_ids);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_financial_activity(
  p_seller_ids uuid[],
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.get_seller_financial_summary(p_seller_ids);
  WITH activity AS (
    SELECT
      'settlement'::text AS type,
      s.id,
      s.order_id,
      s.seller_id,
      s.net_amount AS amount,
      s.settlement_status AS status,
      COALESCE(s.updated_at, s.created_at) AS event_at,
      jsonb_build_object(
        'provider_transfer_id', s.razorpay_transfer_id,
        'hold_reason', s.hold_reason
      ) AS metadata
    FROM public.seller_settlements s
    WHERE s.seller_id = ANY(p_seller_ids)
    UNION ALL
    SELECT
      'refund', r.id, r.order_id, r.seller_id,
      -r.amount, r.refund_state, COALESCE(r.updated_at, r.created_at),
      jsonb_build_object(
        'destination', r.refund_destination,
        'gateway_refund_id', r.gateway_refund_id
      )
    FROM public.refund_requests r
    WHERE r.seller_id = ANY(p_seller_ids)
    UNION ALL
    SELECT
      'cod', c.id, c.order_id, c.seller_id,
      COALESCE(c.collected_amount_minor, c.expected_amount_minor)::numeric / 100,
      c.status, c.updated_at,
      jsonb_build_object(
        'collector_type', c.collector_type,
        'not_withdrawable', c.collector_type = 'seller'
      )
    FROM public.cod_transactions c
    WHERE c.seller_id = ANY(p_seller_ids)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(rows) ORDER BY rows.event_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT *
    FROM activity
    WHERE p_before IS NULL OR event_at < p_before
    ORDER BY event_at DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) rows;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_seller_financial_summary(uuid[])
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_seller_financial_activity(
  uuid[], integer, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_seller_financial_summary(uuid[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_financial_activity(
  uuid[], integer, timestamptz
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_financial_trace(
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_uuid uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  BEGIN
    v_uuid := p_reference::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_uuid := NULL;
  END;

  SELECT jsonb_build_object(
    'reference', p_reference,
    'orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(o))
      FROM public.orders o
      WHERE o.id = v_uuid
         OR o.razorpay_order_id = p_reference
         OR o.razorpay_payment_id = p_reference
    ), '[]'::jsonb),
    'payment_records', COALESCE((
      SELECT jsonb_agg(to_jsonb(pr))
      FROM public.payment_records pr
      WHERE pr.id = v_uuid
         OR pr.order_id = v_uuid
         OR pr.razorpay_payment_id = p_reference
         OR pr.transaction_reference = p_reference
    ), '[]'::jsonb),
    'captures', COALESCE((
      SELECT jsonb_agg(to_jsonb(c))
      FROM public.payment_captures c
      WHERE c.id = v_uuid
         OR c.provider_payment_id = p_reference
         OR c.provider_order_id = p_reference
    ), '[]'::jsonb),
    'capture_allocations', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.payment_capture_allocations a
      JOIN public.payment_captures c ON c.id = a.capture_id
      WHERE a.id = v_uuid
         OR a.order_id = v_uuid
         OR c.provider_payment_id = p_reference
    ), '[]'::jsonb),
    'refunds', COALESCE((
      SELECT jsonb_agg(to_jsonb(r))
      FROM public.refund_requests r
      WHERE r.id = v_uuid
         OR r.order_id = v_uuid
         OR r.gateway_refund_id = p_reference
    ), '[]'::jsonb),
    'settlements', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM public.seller_settlements s
      WHERE s.id = v_uuid
         OR s.order_id = v_uuid
         OR s.razorpay_transfer_id = p_reference
    ), '[]'::jsonb),
    'payout_attempts', COALESCE((
      SELECT jsonb_agg(to_jsonb(pa))
      FROM public.payout_attempts pa
      WHERE pa.id = v_uuid
         OR pa.settlement_id = v_uuid
         OR pa.provider_transfer_id = p_reference
         OR pa.request_key = p_reference
    ), '[]'::jsonb),
    'cod', COALESCE((
      SELECT jsonb_agg(to_jsonb(cod))
      FROM public.cod_transactions cod
      WHERE cod.id = v_uuid OR cod.order_id = v_uuid
    ), '[]'::jsonb),
    'journals', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'transaction', to_jsonb(t),
          'entries', (
            SELECT jsonb_agg(
              to_jsonb(e) || jsonb_build_object('account_code', a.code)
              ORDER BY e.created_at, e.id
            )
            FROM finance.ledger_entries e
            JOIN finance.ledger_accounts a ON a.id = e.account_id
            WHERE e.transaction_id = t.id
          )
        )
      )
      FROM finance.ledger_transactions t
      WHERE t.id = v_uuid
         OR t.reference_id = p_reference
         OR t.idempotency_key = p_reference
    ), '[]'::jsonb),
    'reconciliation', COALESCE((
      SELECT jsonb_agg(to_jsonb(rr))
      FROM public.financial_reconciliation_records rr
      WHERE rr.id = v_uuid OR rr.reference_id = p_reference
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_financial_trace(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_financial_trace(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_financial_overview(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, finance, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  WITH scoped_orders AS (
    SELECT o.*
    FROM public.orders o
    WHERE (p_from IS NULL OR o.created_at >= p_from)
      AND (p_to IS NULL OR o.created_at < p_to)
  ),
  status_rows AS (
    SELECT
      o.status::text AS status,
      count(*)::integer AS count,
      COALESCE(sum(o.total_amount), 0) AS revenue
    FROM scoped_orders o
    GROUP BY o.status
  ),
  payment_totals AS (
    SELECT COALESCE(sum(pr.amount), 0) AS paid
    FROM public.payment_records pr
    WHERE pr.payment_status = 'paid'
      AND (p_from IS NULL OR pr.created_at >= p_from)
      AND (p_to IS NULL OR pr.created_at < p_to)
  ),
  refund_totals AS (
    SELECT COALESCE(sum(r.amount), 0) AS refunded
    FROM public.refund_requests r
    WHERE r.refund_state = 'refund_completed'
      AND (p_from IS NULL OR r.created_at >= p_from)
      AND (p_to IS NULL OR r.created_at < p_to)
  )
  SELECT jsonb_build_object(
    'total_orders', (SELECT count(*) FROM scoped_orders),
    'total_revenue', (
      SELECT payment_totals.paid - refund_totals.refunded
      FROM payment_totals, refund_totals
    ),
    'delivered_revenue', COALESCE((
      SELECT sum(total_amount) FROM scoped_orders
      WHERE status::text IN ('delivered', 'completed')
    ), 0),
    'cancelled_revenue', COALESCE((
      SELECT sum(total_amount) FROM scoped_orders
      WHERE status::text IN ('cancelled', 'no_show')
    ), 0),
    'active_sellers', (
      SELECT count(DISTINCT seller_id) FROM scoped_orders
      WHERE status::text NOT IN ('cancelled', 'no_show')
    ),
    'products_sold', (
      SELECT COALESCE(sum(oi.quantity), 0)
      FROM public.order_items oi
      JOIN scoped_orders o ON o.id = oi.order_id
      WHERE o.status::text NOT IN ('cancelled', 'no_show')
    ),
    'status_breakdown', COALESCE((
      SELECT jsonb_agg(to_jsonb(status_rows) ORDER BY count DESC)
      FROM status_rows
    ), '[]'::jsonb),
    'as_of', now()
  )
  INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_financial_overview(
  timestamptz, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_financial_overview(
  timestamptz, timestamptz
) TO authenticated;

CREATE TABLE IF NOT EXISTS public.financial_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  alert_type text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'acknowledged', 'resolved')
  ),
  dedupe_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz
);
ALTER TABLE public.financial_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view financial alerts"
  ON public.financial_alerts FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.financial_alerts FROM anon, authenticated;
GRANT SELECT ON public.financial_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_alerts TO service_role;

CREATE OR REPLACE FUNCTION finance.raise_financial_exception_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('open', 'investigating') THEN
    INSERT INTO public.financial_alerts (
      severity, alert_type, reference_type, reference_id,
      message, dedupe_key, metadata
    ) VALUES (
      CASE
        WHEN abs(COALESCE(NEW.difference_minor, 0)) >= 100000 THEN 'critical'
        ELSE 'warning'
      END,
      'reconciliation_mismatch',
      NEW.reference_type,
      NEW.reference_id,
      COALESCE(NEW.reason, 'Financial reconciliation exception'),
      'reconciliation:' || NEW.provider || ':' || NEW.reconciliation_date::text
        || ':' || NEW.reference_type || ':' || NEW.reference_id,
      jsonb_build_object(
        'provider', NEW.provider,
        'difference_minor', NEW.difference_minor,
        'reconciliation_record_id', NEW.id
      )
    )
    ON CONFLICT (dedupe_key) DO UPDATE
    SET severity = EXCLUDED.severity,
        message = EXCLUDED.message,
        metadata = EXCLUDED.metadata,
        status = 'open';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_raise_financial_exception_alert
  ON public.financial_reconciliation_records;
CREATE TRIGGER trg_raise_financial_exception_alert
AFTER INSERT OR UPDATE OF status, difference_minor
ON public.financial_reconciliation_records
FOR EACH ROW EXECUTE FUNCTION finance.raise_financial_exception_alert();

-- Defense in depth: RLS already blocks buyer-created payment records, but table
-- INSERT and default PUBLIC function EXECUTE privileges must also be removed.
REVOKE INSERT ON TABLE public.payment_records FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.wallet_ensure_wallet(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_insert_entry(
  uuid, text, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_consume_lots(uuid, text, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_wallet_cash(
  uuid, numeric, text, text, uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_wallet_for_order(
  uuid, numeric, numeric, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_wallet_from_refund(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_wallet_lots(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_wallet_to_checkout_orders(
  uuid, uuid[], numeric, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_wallet_refund(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wallet_ensure_wallet(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_insert_entry(
  uuid, text, text, numeric, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_consume_lots(uuid, text, numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_wallet_cash(
  uuid, numeric, text, text, uuid, uuid, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_wallet_for_order(
  uuid, numeric, numeric, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_wallet_from_refund(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_wallet_lots(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_checkout_orders(
  uuid, uuid[], numeric, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_wallet_refund(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_buyer_wallet(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_wallet_history(integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_wallet_application(numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_wallet_credit(
  numeric, text, text, uuid[]
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_wallet_reservation(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_wallet_reservation(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_wallet_for_orders(uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_wallet_for_orders(uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_wallet_promo(
  uuid, numeric, timestamptz, text, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_wallet_liability()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_buyer_wallet(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_wallet_history(integer, timestamptz)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quote_wallet_application(numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_wallet_credit(
  numeric, text, text, uuid[]
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_wallet_reservation(uuid, uuid[])
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_reservation(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_wallet_for_orders(uuid[])
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_for_orders(uuid[])
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_wallet_promo(
  uuid, numeric, timestamptz, text, text, text, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_wallet_liability()
  TO authenticated, service_role;

COMMIT;
