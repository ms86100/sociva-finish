
-- ============================================================
-- 1. Fix get_allowed_transitions — align return type + logic
-- ============================================================
DROP FUNCTION IF EXISTS public.get_allowed_transitions(uuid, text);

CREATE OR REPLACE FUNCTION public.get_allowed_transitions(
  _order_id uuid,
  _actor text DEFAULT 'seller'::text
)
RETURNS TABLE(status_key text, sort_order integer, actor text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_status text;
  _parent_group text;
  _transaction_type text;
  _order record;
BEGIN
  SELECT o.*, sp.primary_group
  INTO _order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF _order IS NULL THEN RETURN; END IF;

  _parent_group := resolve_transition_parent_group(_order.primary_group);
  _current_status := _order.status::text;

  -- Prefer stored transaction_type
  IF _order.transaction_type IS NOT NULL THEN
    _transaction_type := _order.transaction_type;
  ELSE
    IF _order.order_type = 'enquiry' THEN
      IF _parent_group IN ('education_learning', 'events') THEN _transaction_type := 'service_booking';
      ELSE _transaction_type := 'request_service'; END IF;
    ELSIF _order.order_type = 'booking' THEN _transaction_type := 'service_booking';
    ELSIF _order.fulfillment_type = 'self_pickup' THEN _transaction_type := 'self_fulfillment';
    ELSIF _order.fulfillment_type IN ('delivery','seller_delivery') AND COALESCE(_order.delivery_handled_by,'seller') = 'seller' THEN _transaction_type := 'seller_delivery';
    ELSIF _order.fulfillment_type = 'delivery' AND _order.delivery_handled_by = 'platform' THEN _transaction_type := 'cart_purchase';
    ELSE _transaction_type := 'self_fulfillment'; END IF;
  END IF;

  -- Use transitions table for accuracy (not linear flow)
  RETURN QUERY
  SELECT cst.to_status, csf.sort_order, cst.allowed_actor
  FROM category_status_transitions cst
  LEFT JOIN category_status_flows csf
    ON csf.status_key = cst.to_status
    AND csf.transaction_type = _transaction_type
    AND csf.parent_group = _parent_group
  WHERE cst.from_status = _current_status
    AND cst.allowed_actor = _actor
    AND cst.transaction_type = _transaction_type
    AND (cst.parent_group = _parent_group OR cst.parent_group = 'default')
  ORDER BY CASE WHEN cst.parent_group = _parent_group THEN 0 ELSE 1 END, csf.sort_order;
END;
$$;

-- ============================================================
-- 2. Fix verify_delivery_otp_and_complete — return structured TABLE
-- ============================================================
DROP FUNCTION IF EXISTS public.verify_delivery_otp_and_complete(uuid, text);

CREATE OR REPLACE FUNCTION public.verify_delivery_otp_and_complete(
  _order_id uuid,
  _delivery_code text
)
RETURNS TABLE(order_id uuid, new_status order_status, assignment_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order RECORD;
  _assignment RECORD;
  _caller_id UUID := auth.uid();
  _is_seller BOOLEAN := false;
  _is_rider BOOLEAN := false;
  _current_sort INT;
  _next_step RECORD;
  _txn_type TEXT;
  _parent_group TEXT;
BEGIN
  SELECT o.*, sp.user_id AS seller_user_id, sp.primary_group
  INTO _order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF _order.seller_user_id = _caller_id THEN _is_seller := true; END IF;

  SELECT * INTO _assignment FROM delivery_assignments
  WHERE delivery_assignments.order_id = _order_id ORDER BY created_at DESC LIMIT 1;

  IF _assignment.id IS NOT NULL AND _assignment.rider_id = _caller_id::text THEN _is_rider := true; END IF;
  IF NOT _is_seller AND NOT _is_rider THEN RAISE EXCEPTION 'Not authorized'; END IF;

  IF _assignment.id IS NULL OR _assignment.delivery_code IS NULL THEN
    RAISE EXCEPTION 'No delivery code found';
  END IF;

  IF _assignment.delivery_code != _delivery_code THEN
    UPDATE delivery_assignments SET otp_attempt_count = otp_attempt_count + 1 WHERE id = _assignment.id;
    RAISE EXCEPTION 'Invalid delivery code';
  END IF;

  _parent_group := resolve_transition_parent_group(_order.primary_group);
  _txn_type := COALESCE(_order.transaction_type, 'self_fulfillment');

  SELECT csf.sort_order INTO _current_sort FROM category_status_flows csf
  WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group AND csf.status_key = _order.status::text LIMIT 1;

  IF _current_sort IS NULL THEN
    SELECT csf.sort_order INTO _current_sort FROM category_status_flows csf
    WHERE csf.transaction_type = _txn_type AND csf.parent_group = 'default' AND csf.status_key = _order.status::text LIMIT 1;
    _parent_group := 'default';
  END IF;

  IF _current_sort IS NULL THEN RAISE EXCEPTION 'Cannot find current step for status %', _order.status; END IF;

  SELECT * INTO _next_step FROM category_status_flows csf
  WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group
    AND csf.sort_order > _current_sort AND NOT csf.is_deprecated
  ORDER BY csf.sort_order ASC LIMIT 1;

  IF _next_step.id IS NULL THEN RAISE EXCEPTION 'No next step after %', _order.status; END IF;

  PERFORM set_config('app.otp_verified', 'true', true);
  PERFORM set_config('app.acting_as', CASE WHEN _is_seller THEN 'seller' ELSE 'delivery' END, true);

  UPDATE orders SET status = _next_step.status_key::order_status, updated_at = now() WHERE orders.id = _order_id;

  UPDATE delivery_assignments
  SET otp_verified = true, status = _next_step.status_key,
      delivered_at = CASE WHEN _next_step.status_key IN ('delivered','completed') THEN now() ELSE delivered_at END,
      updated_at = now()
  WHERE delivery_assignments.id = _assignment.id;

  RETURN QUERY SELECT _order_id, _next_step.status_key::order_status, _assignment.id;
END;
$$;
