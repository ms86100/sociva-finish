
-- ============================================================
-- Bug 3: Fix verify_delivery_otp_and_complete — add parent_group filter
-- Bug 4: Fix sync_delivery_to_order_status — remove hardcoded at_gate mapping
-- ============================================================

-- Bug 3: Add parent_group filter to OTP RPC
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
  _parent_group text;
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
  -- Now includes parent_group filter to avoid cross-category matches
  SELECT EXISTS (
    SELECT 1 FROM public.category_status_flows
    WHERE transaction_type = COALESCE(_order_record.transaction_type, 'self_fulfillment')
      AND (parent_group = _parent_group OR parent_group = 'default')
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
  -- Now includes parent_group filter
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.category_status_flows
      WHERE transaction_type = COALESCE(_order_record.transaction_type, 'self_fulfillment')
        AND (parent_group = _parent_group OR parent_group = 'default')
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

-- Bug 4: Remove hardcoded at_gate → on_the_way mapping from sync trigger
CREATE OR REPLACE FUNCTION public.sync_delivery_to_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_target_order_status TEXT;
BEGIN
  -- Skip if status hasn't changed
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Terminal delivery statuses handled by OTP RPC — don't double-sync
  IF NEW.status IN ('delivered', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Fetch order context for workflow resolution
  SELECT o.id, o.status, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = NEW.order_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_parent_group := COALESCE(v_order.primary_group, 'default');

  -- Resolve transaction_type
  SELECT p.listing_type INTO v_listing_type
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = NEW.order_id
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

  -- Find the order-level status that corresponds to this delivery status
  -- Purely workflow-driven: no hardcoded fallback mappings
  SELECT csf.status_key INTO v_target_order_status
  FROM category_status_flows csf
  WHERE (csf.parent_group = v_parent_group OR csf.parent_group = 'default')
    AND csf.transaction_type = v_transaction_type
    AND csf.is_transit = true
    AND csf.status_key = NEW.status
  ORDER BY CASE WHEN csf.parent_group = v_parent_group THEN 0 ELSE 1 END
  LIMIT 1;

  -- If no workflow match found, don't advance the order — the OTP RPC handles terminal states
  IF v_target_order_status IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only advance if the target is different from current
  IF v_target_order_status != v_order.status::text THEN
    PERFORM set_config('app.acting_as', 'delivery', true);
    UPDATE orders
    SET status = v_target_order_status::order_status,
        updated_at = now()
    WHERE id = NEW.order_id
      AND status = v_order.status;
  END IF;

  RETURN NEW;
END;
$$;
