-- ============================================================
-- P4: Partial refunds for checkout groups (child share of capture)
-- - Track amount_refunded on checkout_groups
-- - Compute child gateway refund (last-child gets remainder)
-- - Fix auto-refund refund_state=approved (processor gate)
-- - complete_refund: stamp group totals; fix payment_status; no double wallet/loyalty
-- - Wallet/loyalty cancel triggers also fire on rejected
-- ============================================================

-- ------------------------------------------------------------
-- 1. checkout_groups refund ledger fields
-- ------------------------------------------------------------
ALTER TABLE public.checkout_groups
  ADD COLUMN IF NOT EXISTS amount_refunded numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gateway_captured_amount numeric;

COMMENT ON COLUMN public.checkout_groups.amount_refunded IS
  'Sum of completed gateway refunds against the shared Razorpay capture.';
COMMENT ON COLUMN public.checkout_groups.gateway_captured_amount IS
  'Residual INR captured via Razorpay for this group (sum of child total_amount at pay).';

-- ------------------------------------------------------------
-- 2. Compute child gateway refund amount (partial vs last-child)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_child_gateway_refund_amount(_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders;
  v_child numeric;
  v_capture numeric;
  v_already numeric;
  v_remaining numeric;
  v_other_open integer;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_child := ROUND(COALESCE(o.frozen_total, o.total_amount, 0)::numeric, 2);
  IF v_child <= 0 THEN
    RETURN 0;
  END IF;

  -- Singleton / no shared capture: refund this child's residual only
  IF o.checkout_group_id IS NULL OR o.razorpay_payment_id IS NULL THEN
    RETURN GREATEST(v_child, 0);
  END IF;

  SELECT
    COALESCE(cg.gateway_captured_amount,
      (SELECT ROUND(SUM(COALESCE(sib.frozen_total, sib.total_amount, 0))::numeric, 2)
       FROM public.orders sib
       WHERE sib.checkout_group_id = o.checkout_group_id
         AND sib.razorpay_payment_id IS NOT DISTINCT FROM o.razorpay_payment_id)),
    COALESCE(cg.amount_refunded, 0)
  INTO v_capture, v_already
  FROM public.checkout_groups cg
  WHERE cg.id = o.checkout_group_id;

  v_capture := COALESCE(v_capture, v_child);
  v_already := COALESCE(v_already, 0);
  v_remaining := ROUND(GREATEST(v_capture - v_already, 0)::numeric, 2);

  -- Other siblings still holding / mid-refund on the same capture
  SELECT COUNT(*) INTO v_other_open
  FROM public.orders sib
  WHERE sib.checkout_group_id = o.checkout_group_id
    AND sib.id IS DISTINCT FROM o.id
    AND sib.razorpay_payment_id IS NOT DISTINCT FROM o.razorpay_payment_id
    AND sib.payment_status IN (
      'paid', 'buyer_confirmed', 'seller_verified', 'completed',
      'refund_initiated', 'refund_processing'
    );

  IF COALESCE(v_other_open, 0) = 0 THEN
    -- Last child: clear remaining capture (avoids paise dust / rounding under-refund)
    RETURN v_remaining;
  END IF;

  RETURN ROUND(LEAST(v_child, v_remaining)::numeric, 2);
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_child_gateway_refund_amount(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_child_gateway_refund_amount(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.compute_child_gateway_refund_amount(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 3. Gateway context for refund-processor (payment id + capped amount)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_refund_gateway_context(p_refund_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  o public.orders;
  v_payment_id text;
  v_amount numeric;
  v_group_id uuid;
  v_already numeric := 0;
  v_capture numeric := 0;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_not_found');
  END IF;

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  v_group_id := o.checkout_group_id;
  v_payment_id := NULLIF(o.razorpay_payment_id, '');

  IF v_payment_id IS NULL AND v_group_id IS NOT NULL THEN
    SELECT NULLIF(cg.razorpay_payment_id, '') INTO v_payment_id
    FROM public.checkout_groups cg
    WHERE cg.id = v_group_id;
  END IF;

  v_amount := public.compute_child_gateway_refund_amount(o.id);
  -- Never exceed the refund_request amount (source of truth for this attempt)
  IF COALESCE(r.amount, 0) > 0 THEN
    v_amount := LEAST(v_amount, ROUND(r.amount::numeric, 2));
  END IF;

  IF v_group_id IS NOT NULL THEN
    SELECT COALESCE(cg.amount_refunded, 0),
           COALESCE(cg.gateway_captured_amount, cg.total_amount, 0)
    INTO v_already, v_capture
    FROM public.checkout_groups cg
    WHERE cg.id = v_group_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', r.id,
    'order_id', o.id,
    'checkout_group_id', v_group_id,
    'razorpay_payment_id', v_payment_id,
    'amount', v_amount,
    'requested_amount', r.amount,
    'group_amount_refunded', v_already,
    'group_gateway_captured', v_capture,
    'is_partial', (v_group_id IS NOT NULL AND COALESCE(v_capture, 0) > COALESCE(v_amount, 0) + 0.009)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_refund_gateway_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_refund_gateway_context(uuid) TO service_role;

-- ------------------------------------------------------------
-- 4. Harden auto-refund: child share + refund_state=approved
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auto_refund_on_seller_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_acting text;
  v_is_seller_cancel boolean := false;
  v_refund_amount numeric;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text NOT IN ('cancelled', 'rejected') THEN
    RETURN NEW;
  END IF;

  v_acting := nullif(current_setting('app.acting_as', true), '');

  IF COALESCE(NEW.failure_owner, '') IN ('seller', 'platform') THEN
    v_is_seller_cancel := true;
  ELSIF COALESCE(v_acting, '') = 'seller' THEN
    v_is_seller_cancel := true;
    IF NEW.failure_owner IS NULL THEN
      NEW.failure_owner := 'seller';
    END IF;
  END IF;

  IF NOT v_is_seller_cancel THEN
    RETURN NEW;
  END IF;

  -- Only refund money that was actually collected / confirmed
  IF NEW.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.refund_requests rr
    WHERE rr.order_id = NEW.id
      AND rr.status NOT IN ('rejected')
      AND COALESCE(rr.refund_state, '') NOT IN ('rejected')
  ) THEN
    RETURN NEW;
  END IF;

  -- Child share of shared Razorpay capture (partial); last child gets remainder
  v_refund_amount := public.compute_child_gateway_refund_amount(NEW.id);
  IF v_refund_amount IS NULL OR v_refund_amount <= 0 THEN
    -- Fully covered by loyalty/wallet with zero residual — wallet/loyalty reverse via cancel triggers
    RETURN NEW;
  END IF;

  INSERT INTO public.refund_requests (
    order_id, buyer_id, seller_id, society_id, amount, reason, category,
    status, refund_state, auto_approved, approved_at
  ) VALUES (
    NEW.id,
    NEW.buyer_id,
    NEW.seller_id,
    NEW.society_id,
    v_refund_amount,
    CASE
      WHEN NEW.status::text = 'rejected' THEN 'Order rejected by seller (partial store refund)'
      ELSE COALESCE(NEW.rejection_reason, 'Order cancelled by seller (partial store refund)')
    END,
    'seller_cancelled',
    'approved',
    'approved',  -- critical: refund-processor + cron gate on refund_state
    true,
    now()
  );

  NEW.payment_status := 'refund_initiated';
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- 5. complete_refund: group ledger + payment_status + no double restore
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_refund(
  p_refund_id uuid,
  p_gateway_ref text,
  p_gateway_status text
)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  v_before text;
  o public.orders;
  _paid numeric;
  _frac numeric;
  _restore integer;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _notify_body text;
  _wallet_already boolean := false;
  _loyalty_already boolean := false;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be completed from state: %', r.refund_state;
  END IF;

  UPDATE public.payment_ledger
  SET status = 'success',
      reference_id = p_gateway_ref,
      gateway_response = jsonb_build_object('status', p_gateway_status),
      updated_at = now()
  WHERE refund_id = p_refund_id AND status = 'pending';

  UPDATE public.refund_requests
  SET refund_state = 'refund_completed',
      status = 'settled',
      settled_at = now(),
      gateway_refund_id = p_gateway_ref,
      gateway_status = p_gateway_status,
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  -- Auto-refund sets payment_status=refund_initiated before processor runs
  UPDATE public.orders
  SET payment_status = 'refunded',
      updated_at = now()
  WHERE id = r.order_id
    AND payment_status IN ('paid', 'refund_initiated', 'refund_processing', 'buyer_confirmed', 'seller_verified', 'completed');

  UPDATE public.payment_records
  SET payment_status = 'refunded'
  WHERE order_id = r.order_id
    AND payment_status IN ('paid', 'refund_initiated', 'refund_processing');

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
    -- Bump checkout group refund ledger (idempotent per gateway_ref via refund row)
    IF o.checkout_group_id IS NOT NULL AND COALESCE(r.amount, 0) > 0 THEN
      UPDATE public.checkout_groups cg
      SET amount_refunded = ROUND(COALESCE(cg.amount_refunded, 0) + r.amount, 2),
          payment_status = CASE
            WHEN ROUND(COALESCE(cg.amount_refunded, 0) + r.amount, 2)
                 >= ROUND(COALESCE(cg.gateway_captured_amount, cg.total_amount, 0), 2)
              THEN 'refunded'
            ELSE 'partially_refunded'
          END,
          updated_at = now()
      WHERE cg.id = o.checkout_group_id;

      PERFORM public.refresh_checkout_group_totals(o.checkout_group_id);
    END IF;

    _paid := NULLIF(COALESCE(o.total_amount, 0) + COALESCE(o.wallet_cash_amount, 0) + COALESCE(o.wallet_promo_amount, 0) + COALESCE(o.loyalty_discount_amount, 0), 0);
    IF COALESCE(o.total_amount, 0) > 0 THEN
      _paid := o.total_amount;
    END IF;
    IF _paid IS NOT NULL AND COALESCE(r.amount, 0) > 0 THEN
      _frac := LEAST(GREATEST(r.amount / NULLIF(_paid, 0), 0), 1);
    ELSE
      _frac := 1;
    END IF;

    PERFORM public.reverse_loyalty_earn_for_order(o.id, _frac);

    -- Skip loyalty redeem restore if cancel trigger already restored this order
    SELECT EXISTS (
      SELECT 1 FROM public.loyalty_ledger ll
      WHERE ll.order_id = o.id
        AND ll.entry_type = 'refund_restore'
    ) INTO _loyalty_already;

    IF NOT COALESCE(_loyalty_already, false) THEN
      _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
      IF _restore > 0 THEN
        PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
      END IF;
    END IF;

    -- Skip wallet restore if cancel path already credited this order
    SELECT EXISTS (
      SELECT 1 FROM public.wallet_ledger_txns w
      WHERE w.reference_type = 'order'
        AND w.reference_id = o.id::text
        AND w.type = 'spend_restore'
    ) INTO _wallet_already;

    IF NOT COALESCE(_wallet_already, false)
       AND COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
      _wallet_cash := ROUND(COALESCE(o.wallet_cash_amount, 0) * _frac, 2);
      _wallet_promo := ROUND(COALESCE(o.wallet_promo_amount, 0) * _frac, 2);
      IF _wallet_cash > 0 OR _wallet_promo > 0 THEN
        PERFORM public.restore_wallet_for_order(o.id, _wallet_cash, _wallet_promo, 'refund');
      END IF;
    END IF;
  END IF;

  IF COALESCE(r.refund_destination, 'original_payment') = 'wallet' THEN
    _notify_body := 'Your refund of INR ' || r.amount || ' was credited instantly as Sociva Credit. Usable on Sociva only (not withdrawable). Ref: ' || p_gateway_ref;
  ELSE
    _notify_body := 'Your refund of INR ' || r.amount || ' has been settled to your original payment method. Ref: ' || p_gateway_ref;
  END IF;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object(
            'gateway_ref', p_gateway_ref,
            'gateway_status', p_gateway_status,
            'refund_destination', r.refund_destination,
            'checkout_group_id', o.checkout_group_id,
            'partial', (o.checkout_group_id IS NOT NULL)
          ));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          _notify_body,
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object(
            'orderId', r.order_id,
            'refundId', r.id,
            'status', 'refund_completed',
            'target_role', 'buyer',
            'refund_destination', r.refund_destination,
            'checkoutGroupId', o.checkout_group_id
          ));

  RETURN r;
END;
$function$;

-- ------------------------------------------------------------
-- 6. Wallet / loyalty reverse on rejected (not only cancelled)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_wallet_on_order_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.wallet_reservations;
  _siblings_open integer;
BEGIN
  IF NEW.status::text IN ('cancelled', 'rejected')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.wallet_reservation_id IS NOT NULL THEN
      SELECT * INTO r
      FROM public.wallet_reservations
      WHERE id = NEW.wallet_reservation_id
      FOR UPDATE;

      IF FOUND AND r.status = 'held' THEN
        SELECT COUNT(*) INTO _siblings_open
        FROM public.orders
        WHERE wallet_reservation_id = r.id
          AND id IS DISTINCT FROM NEW.id
          AND status::text NOT IN ('cancelled', 'rejected');

        IF COALESCE(_siblings_open, 0) = 0 THEN
          PERFORM public.release_wallet_reservation(r.id);
        END IF;
      ELSIF FOUND AND r.status = 'committed'
            AND (COALESCE(NEW.wallet_cash_amount, 0) > 0 OR COALESCE(NEW.wallet_promo_amount, 0) > 0) THEN
        PERFORM public.restore_wallet_for_order(
          NEW.id, NEW.wallet_cash_amount, NEW.wallet_promo_amount, 'cancel'
        );
      END IF;
    ELSIF COALESCE(NEW.wallet_cash_amount, 0) > 0 OR COALESCE(NEW.wallet_promo_amount, 0) > 0 THEN
      PERFORM public.restore_wallet_for_order(
        NEW.id, NEW.wallet_cash_amount, NEW.wallet_promo_amount, 'cancel'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_loyalty_on_order_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.loyalty_reservations;
  _siblings_open integer;
BEGIN
  IF NEW.status::text IN ('cancelled', 'rejected')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.loyalty_reservation_id IS NOT NULL THEN
      SELECT * INTO r
      FROM public.loyalty_reservations
      WHERE id = NEW.loyalty_reservation_id
      FOR UPDATE;

      IF FOUND AND r.status = 'held' THEN
        SELECT COUNT(*) INTO _siblings_open
        FROM public.orders
        WHERE loyalty_reservation_id = r.id
          AND id IS DISTINCT FROM NEW.id
          AND status::text NOT IN ('cancelled', 'rejected');

        IF COALESCE(_siblings_open, 0) = 0 THEN
          PERFORM public.release_loyalty_reservation(r.id);
        END IF;
      ELSIF FOUND AND r.status = 'committed' AND COALESCE(NEW.loyalty_points_redeemed, 0) > 0 THEN
        PERFORM public.restore_loyalty_for_order(NEW.id, NEW.loyalty_points_redeemed, 'cancel');
      END IF;
    ELSIF COALESCE(NEW.loyalty_points_redeemed, 0) > 0 THEN
      PERFORM public.restore_loyalty_for_order(NEW.id, NEW.loyalty_points_redeemed, 'cancel');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 7. Stamp gateway_captured_amount when group is marked paid
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_checkout_group_capture(
  _group_id uuid,
  _razorpay_payment_id text,
  _razorpay_order_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_capture numeric;
BEGIN
  IF _group_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ROUND(SUM(COALESCE(o.frozen_total, o.total_amount, 0))::numeric, 2)
  INTO v_capture
  FROM public.orders o
  WHERE o.checkout_group_id = _group_id;

  UPDATE public.checkout_groups
  SET payment_status = 'paid',
      razorpay_payment_id = COALESCE(_razorpay_payment_id, razorpay_payment_id),
      razorpay_order_id = COALESCE(_razorpay_order_id, razorpay_order_id),
      gateway_captured_amount = COALESCE(gateway_captured_amount, v_capture),
      updated_at = now()
  WHERE id = _group_id;

  PERFORM public.refresh_checkout_group_totals(_group_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_checkout_group_capture(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_checkout_group_capture(uuid, text, text) TO service_role;
