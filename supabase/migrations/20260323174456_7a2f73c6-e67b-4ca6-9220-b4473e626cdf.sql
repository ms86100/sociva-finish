
-- Fix: verify_delivery_otp_and_complete — resolve transaction_type dynamically when NULL
-- instead of hardcoded 'self_fulfillment' fallback
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
  _resolved_txn_type text;
  _listing_type text;
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

  -- Resolve transaction_type dynamically when NULL (matching sync_delivery_to_order_status logic)
  _resolved_txn_type := _order_record.transaction_type;
  IF _resolved_txn_type IS NULL THEN
    -- Get listing_type from product
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

    -- Backfill the order's transaction_type so this resolution doesn't repeat
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

  -- DB-driven: check if current status is a transit/delivery step via is_transit flag
  SELECT EXISTS (
    SELECT 1 FROM public.category_status_flows
    WHERE transaction_type = _resolved_txn_type
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
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.category_status_flows
      WHERE transaction_type = _resolved_txn_type
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

-- Backfill any remaining orders with NULL transaction_type
UPDATE public.orders
SET transaction_type = CASE
  WHEN fulfillment_type = 'delivery' AND delivery_handled_by = 'seller' THEN 'seller_delivery'
  WHEN fulfillment_type = 'delivery' AND delivery_handled_by = 'platform' THEN 'cart_purchase'
  WHEN fulfillment_type = 'delivery' THEN 'seller_delivery'
  WHEN fulfillment_type = 'self_pickup' THEN 'self_fulfillment'
  WHEN fulfillment_type = 'seller_delivery' THEN 'seller_delivery'
  WHEN order_type = 'booking' THEN 'service_booking'
  WHEN order_type = 'enquiry' THEN 'request_service'
  ELSE 'self_fulfillment'
END
WHERE transaction_type IS NULL;
