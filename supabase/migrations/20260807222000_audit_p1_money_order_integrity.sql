-- ============================================================
-- Audit Phase 1 — money / order integrity
-- 10) Settlement clawback on complete_refund
-- 12) seller_advance_order SELECT FOR UPDATE + rowcount raise + return status
-- 13) Restore allowed_actor / acting_as in validate_order_status_transition
-- 14) Auto-accept on payment_pending → placed UPDATE + seller notify
--  9) Reinforce auto-refund destination=wallet when no razorpay_payment_id
-- Also: allow refund_initiated → refund_failed for 72h escalation
-- ============================================================

-- Allow initiated → failed (72h manual review escalation / fail_refund)
CREATE OR REPLACE FUNCTION public.enforce_refund_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean := false;
BEGIN
  IF NEW.refund_state IS NOT DISTINCT FROM OLD.refund_state THEN
    RETURN NEW;
  END IF;

  ok := (OLD.refund_state, NEW.refund_state) IN (
    ('requested','approved'),
    ('requested','rejected'),
    ('approved','refund_initiated'),
    ('refund_initiated','refund_processing'),
    ('refund_initiated','refund_completed'),
    ('refund_initiated','refund_failed'),
    ('refund_processing','refund_completed'),
    ('refund_processing','refund_failed'),
    ('refund_failed','refund_initiated')
  );

  IF NOT ok THEN
    RAISE EXCEPTION 'Invalid refund_state transition: % -> %', OLD.refund_state, NEW.refund_state
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- complete_refund: clawback / hold seller_settlements for refunded orders
-- (extends 20260807220000 complete_refund body)
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

  UPDATE public.orders
  SET payment_status = 'refunded',
      updated_at = now()
  WHERE id = r.order_id
    AND payment_status IN ('paid', 'refund_initiated', 'refund_processing', 'buyer_confirmed', 'seller_verified', 'completed');

  UPDATE public.payment_records
  SET payment_status = 'refunded'
  WHERE order_id = r.order_id
    AND payment_status IN ('paid', 'refund_initiated', 'refund_processing');

  -- Settlement clawback: block payout eligibility for refunded orders
  UPDATE public.seller_settlements
  SET settlement_status = CASE
        WHEN settlement_status = 'settled' THEN 'disputed'
        ELSE 'on_hold'
      END,
      hold_reason = COALESCE(hold_reason, '') ||
        CASE WHEN hold_reason IS NULL OR hold_reason = '' THEN '' ELSE ' | ' END ||
        'Order refunded (' || p_gateway_ref || ')',
      eligible_at = NULL,
      updated_at = now()
  WHERE order_id = r.order_id
    AND settlement_status IN ('pending', 'eligible', 'processing', 'settled', 'on_hold');

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
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
            'settlement_clawback', true
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
            'refund_destination', r.refund_destination
          ));

  RETURN r;
END;
$function$;

-- ------------------------------------------------------------
-- Auto-refund: wallet destination when no razorpay payment id
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
  v_dest text := 'original_payment';
  v_payment_id text;
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

  v_refund_amount := public.compute_child_gateway_refund_amount(NEW.id);
  IF v_refund_amount IS NULL OR v_refund_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_payment_id := NULLIF(NEW.razorpay_payment_id, '');
  IF v_payment_id IS NULL AND NEW.checkout_group_id IS NOT NULL THEN
    SELECT NULLIF(cg.razorpay_payment_id, '') INTO v_payment_id
    FROM public.checkout_groups cg
    WHERE cg.id = NEW.checkout_group_id;
  END IF;

  IF v_payment_id IS NULL THEN
    v_dest := 'wallet';
  END IF;

  INSERT INTO public.refund_requests (
    order_id, buyer_id, seller_id, society_id, amount, reason, category,
    status, refund_state, auto_approved, approved_at, refund_destination,
    wallet_credit_amount
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
    'approved',
    true,
    now(),
    v_dest,
    CASE WHEN v_dest = 'wallet' THEN v_refund_amount ELSE 0 END
  );

  NEW.payment_status := 'refund_initiated';
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- seller_advance_order: FOR UPDATE + raise if 0 rows + return status
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.seller_advance_order(uuid, order_status, text);

CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id uuid,
  _new_status order_status,
  _rejection_reason text DEFAULT NULL::text
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_valid BOOLEAN;
  v_updated_id uuid;
  v_final_status order_status;
BEGIN
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status, o.transaction_type,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := v_order.transaction_type;
  ELSE
    SELECT p.listing_type INTO v_listing_type
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = _order_id LIMIT 1;

    IF v_listing_type = 'contact_only' THEN v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning','events') THEN v_transaction_type := 'service_booking';
      ELSE v_transaction_type := 'request_service'; END IF;
    ELSIF v_order.order_type = 'booking' THEN v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery') THEN v_transaction_type := 'seller_delivery';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = _new_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to %', v_order.status, _new_status;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = _new_status,
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      failure_owner = CASE
        WHEN _new_status::text IN ('cancelled', 'rejected') THEN COALESCE(failure_owner, 'seller')
        ELSE failure_owner
      END,
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id AND status = v_order.status
  RETURNING id, status INTO v_updated_id, v_final_status;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_final_status;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seller_advance_order(uuid, order_status, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- validate_order_status_transition: restore acting_as / allowed_actor
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _raw_pg TEXT;
  _parent_group TEXT;
  _txn_type TEXT;
  _valid BOOLEAN;
  _listing_type TEXT;
  _acting_as TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  -- Checkout unpaid hold is managed by payment RPCs (confirm / verify / auto-cancel)
  IF OLD.status::text = 'payment_pending' THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  -- service_role cancels / system paths
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT sp.primary_group INTO _raw_pg
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := resolve_transition_parent_group(_raw_pg);

  IF NEW.transaction_type IS NOT NULL THEN
    _txn_type := NEW.transaction_type;
  ELSE
    SELECT p.listing_type INTO _listing_type
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.id LIMIT 1;

    IF _listing_type = 'contact_only' THEN _txn_type := 'contact_enquiry';
    ELSIF NEW.order_type = 'enquiry' THEN
      IF _parent_group IN ('education_learning','events') THEN _txn_type := 'service_booking';
      ELSE _txn_type := 'request_service'; END IF;
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type = 'self_pickup' THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by,'seller') = 'seller' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

  _acting_as := nullif(current_setting('app.acting_as', true), '');

  IF _acting_as IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
        AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
          AND (allowed_actor = _acting_as OR position(_acting_as IN allowed_actor) > 0)
      ) INTO _valid;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = _parent_group AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
    ) INTO _valid;

    IF NOT _valid AND _parent_group != 'default' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default' AND transaction_type = _txn_type
          AND from_status = OLD.status::text AND to_status = NEW.status::text
      ) INTO _valid;
    END IF;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%, actor=%)',
      OLD.status, NEW.status, _parent_group, _txn_type, COALESCE(_acting_as, 'any');
  END IF;

  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- Auto-accept: also fire on payment_pending → placed UPDATE
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_order_auto_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller RECORD;
  v_today_count int;
  v_current_day text;
BEGIN
  -- INSERT with placed, or UPDATE payment_pending → placed (payment confirm)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status::text <> 'placed'
       OR OLD.status::text IS NOT DISTINCT FROM NEW.status::text
       OR OLD.status::text <> 'payment_pending' THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.status::text <> 'placed' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.auto_accepted, false) THEN
    RETURN NEW;
  END IF;

  SELECT auto_accept_enabled, operating_days, availability_start, availability_end, daily_order_limit
  INTO v_seller
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF NOT FOUND OR NOT v_seller.auto_accept_enabled THEN
    RETURN NEW;
  END IF;

  v_current_day := lower(trim(to_char(now() AT TIME ZONE 'Asia/Kolkata', 'Day')));
  IF v_seller.operating_days IS NOT NULL AND array_length(v_seller.operating_days, 1) > 0 THEN
    IF NOT (v_current_day = ANY(v_seller.operating_days)) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_seller.availability_start IS NOT NULL AND v_seller.availability_end IS NOT NULL THEN
    IF (now() AT TIME ZONE 'Asia/Kolkata')::time < v_seller.availability_start
       OR (now() AT TIME ZONE 'Asia/Kolkata')::time > v_seller.availability_end THEN
      RETURN NEW;
    END IF;
  END IF;

  IF v_seller.daily_order_limit IS NOT NULL AND v_seller.daily_order_limit > 0 THEN
    SELECT count(*) INTO v_today_count
    FROM public.orders
    WHERE seller_id = NEW.seller_id
      AND created_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND status NOT IN ('cancelled', 'returned');

    IF v_today_count >= v_seller.daily_order_limit THEN
      RETURN NEW;
    END IF;
  END IF;

  NEW.status := 'preparing';
  NEW.auto_accepted := true;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_order_auto_accept ON public.orders;
CREATE TRIGGER trg_order_auto_accept
  BEFORE INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_auto_accept();

-- Notify seller when auto-accept happens on UPDATE (INSERT path already covered)
CREATE OR REPLACE FUNCTION public.log_auto_accept_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name text;
BEGIN
  IF NEW.auto_accepted IS TRUE AND (TG_OP = 'INSERT' OR COALESCE(OLD.auto_accepted, false) IS DISTINCT FROM true) THEN
    INSERT INTO public.order_activity (order_id, actor_type, action, details)
    VALUES (
      NEW.id,
      'system',
      'auto_accepted',
      jsonb_build_object(
        'message', 'Order was automatically accepted by the system',
        'from_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE 'placed' END,
        'to_status', NEW.status::text
      )
    );

    -- Ensure seller is notified (especially UPDATE path after payment confirm)
    SELECT user_id INTO _seller_user_id FROM public.seller_profiles WHERE id = NEW.seller_id;
    SELECT name INTO _buyer_name FROM public.profiles WHERE id = NEW.buyer_id;
    IF _seller_user_id IS NOT NULL THEN
      INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (
        _seller_user_id,
        'Order Auto-Accepted',
        COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || COALESCE(NEW.total_amount, 0) || '. Auto-accepted — start preparing!',
        'order',
        '/seller/orders/' || NEW.id,
        jsonb_build_object(
          'order_id', NEW.id,
          'buyer_name', _buyer_name,
          'total', NEW.total_amount,
          'auto_accepted', true,
          'target_role', 'seller'
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_log_auto_accept_activity ON public.orders;
CREATE TRIGGER trg_log_auto_accept_activity
  AFTER INSERT OR UPDATE OF status, auto_accepted ON public.orders
  FOR EACH ROW
  WHEN (NEW.auto_accepted = true)
  EXECUTE FUNCTION public.log_auto_accept_activity();

-- ------------------------------------------------------------
-- Allow needs_manual_review for 72h stuck-refund escalation (no blind complete)
-- ------------------------------------------------------------
ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_state_check;
ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_state_check CHECK (refund_state IN (
    'requested','approved','rejected',
    'refund_initiated','refund_processing',
    'refund_completed','refund_failed',
    'needs_manual_review'
  ));
