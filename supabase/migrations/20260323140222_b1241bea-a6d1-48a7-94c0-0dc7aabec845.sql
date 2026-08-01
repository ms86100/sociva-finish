
-- Step 4: Simplify validate_order_status_transition trigger to use stored transaction_type
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

  IF NEW.status::text = 'cancelled' THEN
    IF current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT sp.primary_group INTO _parent_group
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  -- Use stored transaction_type directly (set at order creation)
  -- Fall back to resolution logic only for legacy orders without transaction_type
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

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" for parent_group=% txn_type=%',
      OLD.status, NEW.status, COALESCE(_parent_group, 'default'), _txn_type;
  END IF;

  RETURN NEW;
END;
$$;

-- Step 5: Update verify_delivery_otp_and_complete to use is_transit from DB
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
    status = 'completed',
    delivered_at = now(),
    needs_attention = false,
    needs_attention_reason = null,
    updated_at = now()
  WHERE id = _order_id;

  PERFORM set_config('app.otp_verified', 'false', true);

  RETURN QUERY
  SELECT _order_id, _assignment_record.id, 'completed'::public.order_status;
END;
$$;
