-- Harden buyer location updates and delivery OTP verification

-- 1) Remove overly broad buyer update policy if it exists
DROP POLICY IF EXISTS "Buyers can update delivery coords on own orders" ON public.orders;

-- 2) RPC: allow buyers to update only their own delivery coordinates
CREATE OR REPLACE FUNCTION public.update_buyer_delivery_location(
  _order_id uuid,
  _delivery_lat double precision,
  _delivery_lng double precision
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated public.orders;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _delivery_lat IS NULL OR _delivery_lng IS NULL THEN
    RAISE EXCEPTION 'Coordinates are required';
  END IF;

  IF _delivery_lat < -90 OR _delivery_lat > 90 THEN
    RAISE EXCEPTION 'Invalid latitude';
  END IF;

  IF _delivery_lng < -180 OR _delivery_lng > 180 THEN
    RAISE EXCEPTION 'Invalid longitude';
  END IF;

  UPDATE public.orders
  SET
    delivery_lat = _delivery_lat,
    delivery_lng = _delivery_lng,
    updated_at = now()
  WHERE id = _order_id
    AND buyer_id = auth.uid()
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or not owned by user';
  END IF;

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_buyer_delivery_location(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_buyer_delivery_location(uuid, double precision, double precision) TO authenticated;

-- 3) RPC: verify OTP and mark seller-handled delivery as delivered atomically
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _delivery_code IS NULL OR btrim(_delivery_code) = '' THEN
    RAISE EXCEPTION 'OTP is required';
  END IF;

  SELECT * INTO _order_record
  FROM public.orders
  WHERE id = _order_id
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

  IF _order_record.status NOT IN ('picked_up', 'on_the_way', 'arrived', 'at_gate') THEN
    RAISE EXCEPTION 'Order is not ready for delivery confirmation';
  END IF;

  SELECT * INTO _assignment_record
  FROM public.delivery_assignments
  WHERE order_id = _order_id
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

  UPDATE public.delivery_assignments
  SET
    status = 'delivered',
    delivered_at = now(),
    otp_attempt_count = COALESCE(otp_attempt_count, 0) + 1,
    updated_at = now()
  WHERE id = _assignment_record.id;

  UPDATE public.orders
  SET
    status = 'delivered',
    updated_at = now()
  WHERE id = _order_id;

  RETURN QUERY
  SELECT _order_id, _assignment_record.id, 'delivered'::public.order_status;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_delivery_otp_and_complete(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_delivery_otp_and_complete(uuid, text) TO authenticated;