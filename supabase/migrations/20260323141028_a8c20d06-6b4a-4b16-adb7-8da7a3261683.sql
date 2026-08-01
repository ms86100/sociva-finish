
-- Bug 4 fix: Update service_complete_delivery to dynamically determine target status
-- Instead of hardcoding 'delivered' on orders, check if 'delivered' exists in the flow.
-- If it does, go to 'delivered'. If not, go to 'completed'.
CREATE OR REPLACE FUNCTION public.service_complete_delivery(
  _assignment_id uuid,
  _order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _txn_type text;
  _target_order_status text;
BEGIN
  -- Resolve transaction type from the order
  SELECT COALESCE(transaction_type, 'self_fulfillment') INTO _txn_type
  FROM public.orders WHERE id = _order_id;

  -- Check if 'delivered' is a distinct (non-terminal) step in the workflow
  -- If so, advance to 'delivered' (buyer can then confirm to 'completed')
  -- If 'delivered' IS terminal or doesn't exist, go to 'completed'
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.category_status_flows
      WHERE transaction_type = _txn_type
        AND status_key = 'delivered'
        AND is_terminal = false
    ) THEN 'delivered'
    ELSE 'completed'
  END INTO _target_order_status;

  -- Set the OTP verified flag FIRST so triggers allow the transition
  PERFORM set_config('app.otp_verified', 'true', true);

  -- Update delivery assignment to delivered
  UPDATE public.delivery_assignments
  SET
    status = 'delivered',
    delivered_at = now(),
    otp_hash = null,
    updated_at = now()
  WHERE id = _assignment_id;

  -- Update order to the dynamically determined status
  UPDATE public.orders
  SET
    status = _target_order_status::order_status,
    delivered_at = now(),
    needs_attention = false,
    needs_attention_reason = null,
    updated_at = now()
  WHERE id = _order_id;

  -- Reset flag
  PERFORM set_config('app.otp_verified', 'false', true);
END;
$$;

-- Bug 4 fix: Update verify_delivery_otp_and_complete similarly
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
  _is_transit_status boolean;
  _target_order_status text;
BEGIN
  IF auth.uid() IS NULL THEN
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

  SELECT sp.user_id INTO _seller_user_id
  FROM public.seller_profiles sp
  WHERE sp.id = _order_record.seller_id;

  IF _seller_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the seller can complete this delivery';
  END IF;

  IF COALESCE(_order_record.delivery_handled_by, 'seller') = 'platform' THEN
    RAISE EXCEPTION 'Platform deliveries must be completed by the assigned delivery partner';
  END IF;

  -- DB-driven: check if current status is a transit/delivery step via is_transit flag
  SELECT EXISTS (
    SELECT 1 FROM public.category_status_flows
    WHERE transaction_type = COALESCE(_order_record.transaction_type, 'self_fulfillment')
      AND status_key = _order_record.status::text
      AND (is_transit = true OR actor = 'delivery')
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

  -- Bug 4 fix: Dynamically determine target order status from workflow
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
