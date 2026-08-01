
-- Bug 2 Fix: Allow delivery partners (rider_user_id) to verify OTP, not just sellers
-- Bug 4 Fix: Add actor enforcement to validate_order_status_transition via session flag

-- ============================================================
-- Bug 2: verify_delivery_otp_and_complete — accept rider OR seller
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_delivery_otp_and_complete(
  _order_id uuid,
  _delivery_code text
)
RETURNS TABLE(order_id uuid, assignment_id uuid, new_status public.order_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order_record public.orders;
  _assignment_record public.delivery_assignments;
  _seller_user_id uuid;
  _rider_user_id uuid;
  _is_transit_status boolean;
  _target_order_status text;
  _caller_id uuid;
BEGIN
  _caller_id := auth.uid();

  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _delivery_code IS NULL OR btrim(_delivery_code) = '' THEN
    RAISE EXCEPTION 'OTP is required';
  END IF;

  SELECT * INTO _order_record
  FROM public.orders o
  WHERE o.id = _order_id
  FOR UPDATE;

  IF _order_record.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Get seller user_id
  SELECT sp.user_id INTO _seller_user_id
  FROM public.seller_profiles sp
  WHERE sp.id = _order_record.seller_id;

  -- Get rider user_id from delivery assignment (if any)
  SELECT da.rider_id INTO _rider_user_id
  FROM public.delivery_partner_pool dpp
  JOIN public.delivery_assignments da ON da.rider_id = dpp.id AND da.order_id = _order_id
  WHERE dpp.user_id = _caller_id;

  -- Authorization: caller must be the seller OR the assigned delivery rider
  IF _seller_user_id IS DISTINCT FROM _caller_id
     AND _rider_user_id IS NULL THEN
    RAISE EXCEPTION 'Only the seller or assigned delivery partner can complete this delivery';
  END IF;

  IF COALESCE(_order_record.delivery_handled_by, 'seller') = 'platform' THEN
    RAISE EXCEPTION 'Platform deliveries must be completed by the assigned delivery partner';
  END IF;

  -- DB-driven: check if current status is a transit/delivery step via is_transit flag
  SELECT EXISTS (
    SELECT 1 FROM public.category_status_flows
    WHERE transaction_type = COALESCE(_order_record.transaction_type, 'self_fulfillment')
      AND status_key = _order_record.status::text
      AND (is_transit = true OR actor LIKE '%delivery%')
  ) INTO _is_transit_status;

  IF NOT _is_transit_status THEN
    RAISE EXCEPTION 'Order is not ready for delivery confirmation';
  END IF;

  SELECT * INTO _assignment_record
  FROM public.delivery_assignments da
  WHERE da.order_id = _order_id
  FOR UPDATE;

  IF _assignment_record.id IS NULL THEN
    RAISE EXCEPTION 'Delivery assignment not found';
  END IF;

  IF _assignment_record.status IN ('delivered', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Delivery assignment is no longer active';
  END IF;

  IF _assignment_record.delivery_code IS NULL THEN
    RAISE EXCEPTION 'Delivery code is not available';
  END IF;

  IF btrim(_assignment_record.delivery_code) <> btrim(_delivery_code) THEN
    UPDATE public.delivery_assignments
    SET otp_attempt_count = COALESCE(otp_attempt_count, 0) + 1,
        updated_at = now()
    WHERE id = _assignment_record.id;

    RAISE EXCEPTION 'Invalid delivery code';
  END IF;

  -- Dynamically determine target order status from workflow
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.category_status_flows
      WHERE transaction_type = COALESCE(_order_record.transaction_type, 'self_fulfillment')
        AND status_key = 'delivered'
        AND is_terminal = false
    ) THEN 'delivered'
    ELSE 'completed'
  END INTO _target_order_status;

  PERFORM set_config('app.otp_verified', 'true', true);

  UPDATE public.delivery_assignments
  SET
    status = 'delivered',
    delivered_at = now(),
    otp_attempt_count = COALESCE(otp_attempt_count, 0) + 1,
    updated_at = now()
  WHERE id = _assignment_record.id;

  UPDATE public.orders
  SET
    status = _target_order_status::order_status,
    delivered_at = now(),
    needs_attention = false,
    needs_attention_reason = null,
    updated_at = now()
  WHERE id = _order_id;

  PERFORM set_config('app.otp_verified', 'false', true);

  RETURN QUERY
  SELECT _order_id, _assignment_record.id, _target_order_status::public.order_status;
END;
$$;

-- ============================================================
-- Bug 4: validate_order_status_transition — add actor enforcement via session flag
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _parent_group text;
  _txn_type text;
  _valid boolean;
  _acting_as text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- payment_pending is a pre-flow state; transitions out of it are managed by RPCs
  IF OLD.status::text = 'payment_pending' THEN
    RETURN NEW;
  END IF;

  -- OTP-verified delivery completion can skip intermediate steps
  IF current_setting('app.otp_verified', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- service_role (system/edge functions) can do anything
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT sp.primary_group INTO _parent_group
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  -- Use stored transaction_type directly (set at order creation)
  _txn_type := NEW.transaction_type;

  IF _txn_type IS NULL THEN
    IF NEW.order_type = 'enquiry' THEN
      IF _parent_group IN ('classes', 'events') THEN _txn_type := 'service_booking';
      ELSE _txn_type := 'request_service'; END IF;
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type IN ('self_pickup') THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

  -- Read the acting_as session flag (set by RPCs like buyer_advance_order)
  _acting_as := current_setting('app.acting_as', true);

  IF _acting_as IS NOT NULL AND _acting_as <> '' THEN
    -- Actor-aware validation: check transition exists for the specific actor
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE (parent_group = COALESCE(_parent_group, 'default') OR parent_group = 'default')
        AND transaction_type = _txn_type
        AND from_status = OLD.status::text
        AND to_status = NEW.status::text
        AND allowed_actor = _acting_as
    ) INTO _valid;
  ELSE
    -- No actor flag set (direct update from seller via RLS) — validate transition exists for any actor
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = COALESCE(_parent_group, 'default')
        AND transaction_type = _txn_type
        AND from_status = OLD.status::text
        AND to_status = NEW.status::text
    ) INTO _valid;

    IF NOT _valid AND _parent_group IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.category_status_transitions
        WHERE parent_group = 'default'
          AND transaction_type = _txn_type
          AND from_status = OLD.status::text
          AND to_status = NEW.status::text
      ) INTO _valid;
    END IF;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" for parent_group=% txn_type=% actor=%',
      OLD.status, NEW.status, COALESCE(_parent_group, 'default'), _txn_type, COALESCE(_acting_as, 'unknown');
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- Set app.acting_as in buyer_advance_order so the trigger can enforce actor
-- ============================================================
CREATE OR REPLACE FUNCTION public.buyer_advance_order(_order_id uuid, _new_status order_status)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_valid BOOLEAN;
  v_listing_type TEXT;
BEGIN
  SELECT o.id, o.status, o.buyer_id, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         o.payment_type, o.payment_status,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized — you are not the buyer of this order';
  END IF;

  v_parent_group := COALESCE(v_order.primary_group, 'default');

  SELECT cc.transaction_type INTO v_listing_type
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN category_config cc ON cc.category::text = p.category
  WHERE oi.order_id = _order_id
  LIMIT 1;

  IF v_listing_type = 'contact_only' THEN
    v_transaction_type := 'contact_enquiry';
  ELSIF v_order.order_type = 'enquiry' THEN
    IF v_parent_group IN ('classes', 'events') THEN
      v_transaction_type := 'service_booking';
    ELSE
      v_transaction_type := 'request_service';
    END IF;
  ELSIF v_order.order_type = 'booking' THEN
    v_transaction_type := 'service_booking';
  ELSIF v_order.fulfillment_type = 'self_pickup' THEN
    v_transaction_type := 'self_fulfillment';
  ELSIF v_order.fulfillment_type = 'seller_delivery' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF v_order.fulfillment_type = 'delivery' AND (v_order.delivery_handled_by IS NULL OR v_order.delivery_handled_by = 'seller') THEN
    v_transaction_type := 'seller_delivery';
  ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
    v_transaction_type := 'cart_purchase';
  ELSE
    v_transaction_type := 'self_fulfillment';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text
      AND to_status = _new_status::text
      AND allowed_actor = 'buyer'
      AND (
        (parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type)
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid buyer transition from % to %', v_order.status, _new_status;
  END IF;

  -- Set actor flag so the trigger knows who is acting
  PERFORM set_config('app.acting_as', 'buyer', true);

  -- For COD orders transitioning to completed, auto-mark payment as paid
  IF _new_status::text = 'completed' AND v_order.payment_type = 'cod' AND COALESCE(v_order.payment_status, 'pending') <> 'paid' THEN
    UPDATE orders
    SET status = _new_status,
        payment_status = 'paid',
        payment_confirmed_at = now(),
        buyer_confirmed_at = now(),
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  ELSE
    UPDATE orders
    SET status = _new_status,
        buyer_confirmed_at = CASE WHEN _new_status::text = 'completed' THEN now() ELSE buyer_confirmed_at END,
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  END IF;
END;
$function$;
