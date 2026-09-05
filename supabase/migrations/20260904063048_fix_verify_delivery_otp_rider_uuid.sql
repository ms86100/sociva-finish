-- Fix uuid = text crash in verify_delivery_otp_and_complete (rider_id is uuid).
CREATE OR REPLACE FUNCTION public.verify_delivery_otp_and_complete(
  _order_id uuid,
  _delivery_code text,
  _target_status text DEFAULT NULL::text
)
RETURNS TABLE(order_id uuid, new_status order_status, assignment_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- rider_id is uuid; never cast caller to text for equality
  IF _assignment.id IS NOT NULL AND _assignment.rider_id IS NOT NULL AND _assignment.rider_id = _caller_id THEN
    _is_rider := true;
  END IF;
  IF NOT _is_seller AND NOT _is_rider THEN RAISE EXCEPTION 'Not authorized'; END IF;

  IF _assignment.id IS NULL OR _assignment.delivery_code IS NULL THEN
    RAISE EXCEPTION 'No delivery code found';
  END IF;

  IF _assignment.delivery_code != _delivery_code THEN
    UPDATE delivery_assignments SET otp_attempt_count = COALESCE(otp_attempt_count, 0) + 1 WHERE id = _assignment.id;
    RAISE EXCEPTION 'Invalid delivery code';
  END IF;

  _parent_group := COALESCE(resolve_transition_parent_group(_order.primary_group), 'default');
  _txn_type := COALESCE(_order.transaction_type, 'self_fulfillment');

  SELECT csf.sort_order INTO _current_sort FROM category_status_flows csf
  WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group AND csf.status_key = _order.status::text LIMIT 1;

  IF _current_sort IS NULL THEN
    SELECT csf.sort_order INTO _current_sort FROM category_status_flows csf
    WHERE csf.transaction_type = _txn_type AND csf.parent_group = 'default' AND csf.status_key = _order.status::text LIMIT 1;
    _parent_group := 'default';
  END IF;

  IF _current_sort IS NULL THEN RAISE EXCEPTION 'Cannot find current step for status %', _order.status; END IF;

  IF _target_status IS NOT NULL THEN
    SELECT * INTO _next_step FROM category_status_flows csf
    WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group
      AND csf.status_key = _target_status AND NOT csf.is_deprecated
    LIMIT 1;

    IF _next_step.id IS NULL THEN
      RAISE EXCEPTION 'Status % is not part of this order flow', _target_status;
    END IF;
    IF _next_step.sort_order <= _current_sort THEN
      RAISE EXCEPTION 'Cannot move order backwards from % to %', _order.status, _target_status;
    END IF;
  ELSE
    SELECT * INTO _next_step FROM category_status_flows csf
    WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group
      AND csf.sort_order > _current_sort AND NOT csf.is_deprecated
      AND csf.status_key IN ('delivered', 'buyer_received', 'completed')
    ORDER BY
      CASE csf.status_key WHEN 'delivered' THEN 1 WHEN 'buyer_received' THEN 2 ELSE 3 END,
      csf.sort_order ASC
    LIMIT 1;

    IF _next_step.id IS NULL THEN
      SELECT * INTO _next_step FROM category_status_flows csf
      WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group
        AND csf.sort_order > _current_sort AND NOT csf.is_deprecated
      ORDER BY csf.sort_order ASC LIMIT 1;
    END IF;

    IF _next_step.id IS NULL THEN RAISE EXCEPTION 'No next step after %', _order.status; END IF;
  END IF;

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
$function$;
