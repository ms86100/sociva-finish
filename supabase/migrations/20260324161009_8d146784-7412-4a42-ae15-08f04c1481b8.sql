
-- ================================================================
-- FIX Issues 1 + 7: verify_delivery_otp_and_complete
-- - Check IMMEDIATE next step (not any future step) for delivery OTP
-- - Validate transition exists in category_status_transitions (don't bypass)
-- ================================================================
CREATE OR REPLACE FUNCTION public.verify_delivery_otp_and_complete(
  _order_id uuid,
  _delivery_code text
)
RETURNS TABLE (order_id uuid, assignment_id uuid, new_status public.order_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order_record public.orders;
  _assignment_record public.delivery_assignments;
  _seller_user_id uuid;
  _rider_user_id uuid;
  _parent_group text;
  _resolved_txn_type text;
  _listing_type text;
  _current_sort_order integer;
  _next_step_status text;
  _next_step_otp_type text;
  _next_step_is_terminal boolean;
  _caller_id uuid;
  _transition_valid boolean;
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

  -- Get seller user_id AND parent_group
  SELECT sp.user_id, COALESCE(sp.primary_group, 'default')
  INTO _seller_user_id, _parent_group
  FROM public.seller_profiles sp
  WHERE sp.id = _order_record.seller_id;

  _parent_group := COALESCE(_parent_group, 'default');

  -- Resolve transaction_type
  _resolved_txn_type := _order_record.transaction_type;
  IF _resolved_txn_type IS NULL THEN
    SELECT p.listing_type INTO _listing_type
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = _order_id
    LIMIT 1;

    IF _listing_type = 'contact_only' THEN
      _resolved_txn_type := 'contact_enquiry';
    ELSIF _order_record.order_type = 'enquiry' THEN
      IF _parent_group IN ('classes', 'events') THEN
        _resolved_txn_type := 'service_booking';
      ELSE
        _resolved_txn_type := 'request_service';
      END IF;
    ELSIF _order_record.order_type = 'booking' THEN
      _resolved_txn_type := 'service_booking';
    ELSIF _order_record.fulfillment_type = 'self_pickup' THEN
      _resolved_txn_type := 'self_fulfillment';
    ELSIF _order_record.fulfillment_type = 'seller_delivery' THEN
      _resolved_txn_type := 'seller_delivery';
    ELSIF _order_record.fulfillment_type = 'delivery' AND (COALESCE(_order_record.delivery_handled_by, 'seller') = 'seller') THEN
      _resolved_txn_type := 'seller_delivery';
    ELSIF _order_record.fulfillment_type = 'delivery' AND _order_record.delivery_handled_by = 'platform' THEN
      _resolved_txn_type := 'cart_purchase';
    ELSE
      _resolved_txn_type := 'self_fulfillment';
    END IF;

    UPDATE public.orders SET transaction_type = _resolved_txn_type WHERE id = _order_id;
  END IF;

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

  -- Get current step sort_order
  SELECT csf.sort_order INTO _current_sort_order
  FROM public.category_status_flows csf
  WHERE csf.transaction_type = _resolved_txn_type
    AND csf.parent_group IN (_parent_group, 'default')
    AND csf.status_key = _order_record.status::text
  ORDER BY (csf.parent_group = _parent_group) DESC
  LIMIT 1;

  IF _current_sort_order IS NULL THEN
    RAISE EXCEPTION 'Current order status not found in workflow';
  END IF;

  -- FIX Issue 1: Get the IMMEDIATE next step and check if IT specifically requires delivery OTP
  SELECT csf.status_key, csf.otp_type, COALESCE(csf.is_terminal, false)
  INTO _next_step_status, _next_step_otp_type, _next_step_is_terminal
  FROM public.category_status_flows csf
  WHERE csf.transaction_type = _resolved_txn_type
    AND csf.parent_group IN (_parent_group, 'default')
    AND csf.sort_order > _current_sort_order
  ORDER BY csf.sort_order ASC
  LIMIT 1;

  IF _next_step_status IS NULL THEN
    RAISE EXCEPTION 'No next step found in workflow';
  END IF;

  -- Only allow if the IMMEDIATE next step requires delivery OTP
  IF _next_step_otp_type IS DISTINCT FROM 'delivery' THEN
    RAISE EXCEPTION 'Next step "%" does not require delivery OTP verification', _next_step_status;
  END IF;

  -- Validate delivery assignment
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

  -- FIX Issue 7: Validate transition exists in transitions table BEFORE bypassing
  SELECT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE parent_group IN (_parent_group, 'default')
      AND transaction_type = _resolved_txn_type
      AND from_status = _order_record.status::text
      AND to_status = _next_step_status
  ) INTO _transition_valid;

  IF NOT _transition_valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" — no transition rule defined', _order_record.status, _next_step_status;
  END IF;

  -- Set OTP verified flag (bypasses enforce_otp_gate since we already verified)
  PERFORM set_config('app.otp_verified', 'true', true);

  -- Update delivery assignment conditionally
  UPDATE public.delivery_assignments
  SET
    status = CASE WHEN _next_step_is_terminal THEN 'delivered' ELSE _assignment_record.status END,
    delivered_at = CASE WHEN _next_step_is_terminal THEN now() ELSE _assignment_record.delivered_at END,
    otp_attempt_count = COALESCE(otp_attempt_count, 0) + 1,
    updated_at = now()
  WHERE id = _assignment_record.id;

  -- Advance order to next step
  UPDATE public.orders
  SET
    status = _next_step_status::order_status,
    delivered_at = CASE WHEN _next_step_is_terminal THEN now() ELSE _order_record.delivered_at END,
    needs_attention = false,
    needs_attention_reason = null,
    updated_at = now()
  WHERE id = _order_id;

  PERFORM set_config('app.otp_verified', 'false', true);

  RETURN QUERY
  SELECT _order_id, _assignment_record.id, _next_step_status::public.order_status;
END;
$$;

-- ================================================================
-- FIX Issue 2: enforce_otp_gate — raise error when delivery OTP
-- configured but no delivery assignment (instead of silent pass)
-- ================================================================
CREATE OR REPLACE FUNCTION public.enforce_otp_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp_type text;
  v_parent_group text;
  v_transaction_type text;
  has_delivery_code boolean;
  has_verified_generic boolean;
  has_delivery_assignment boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.otp_verified', true) = 'true' THEN
    RETURN NEW;
  END IF;

  v_transaction_type := COALESCE(NEW.transaction_type, 'seller_delivery');

  SELECT sp.primary_group INTO v_parent_group
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;
  v_parent_group := COALESCE(v_parent_group, 'default');

  -- Look up otp_type for the target status
  SELECT csf.otp_type INTO v_otp_type
  FROM public.category_status_flows csf
  WHERE csf.status_key = NEW.status::text
    AND csf.transaction_type = v_transaction_type
    AND csf.parent_group = v_parent_group
  LIMIT 1;

  IF v_otp_type IS NULL THEN
    SELECT csf.otp_type INTO v_otp_type
    FROM public.category_status_flows csf
    WHERE csf.status_key = NEW.status::text
      AND csf.transaction_type = v_transaction_type
      AND csf.parent_group = 'default'
    LIMIT 1;
  END IF;

  IF v_otp_type IS NULL THEN
    RETURN NEW;
  END IF;

  -- DELIVERY OTP
  IF v_otp_type = 'delivery' THEN
    -- First check if delivery assignment exists at all
    SELECT EXISTS (
      SELECT 1 FROM public.delivery_assignments
      WHERE order_id = NEW.id
        AND status NOT IN ('cancelled', 'failed')
    ) INTO has_delivery_assignment;

    IF NOT has_delivery_assignment THEN
      -- FIX: Raise error instead of silently passing
      RAISE EXCEPTION 'Delivery OTP required but no delivery assignment exists. Check workflow configuration — "Start Delivery Here" must be on an earlier step.';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.delivery_assignments
      WHERE order_id = NEW.id
        AND delivery_code IS NOT NULL
        AND status NOT IN ('cancelled', 'failed')
    ) INTO has_delivery_code;

    IF has_delivery_code THEN
      RAISE EXCEPTION 'Delivery OTP verification required. Use the verify_delivery_otp_and_complete function.';
    END IF;

    -- Delivery assignment exists but no code yet — shouldn't happen but be safe
    RAISE EXCEPTION 'Delivery OTP verification required but delivery code not generated yet.';
  END IF;

  -- GENERIC OTP
  IF v_otp_type = 'generic' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.order_otp_codes
      WHERE order_id = NEW.id
        AND target_status = NEW.status::text
        AND verified = true
        AND expires_at > now()
    ) INTO has_verified_generic;

    IF NOT has_verified_generic THEN
      RAISE EXCEPTION 'OTP verification required for this step. Use the verify_generic_otp_and_advance function.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
