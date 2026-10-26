-- Align seller_complete_order_without_otp with seller transitions.
-- UI allows on_the_way → delivered (OTP / manual). Linear flow may insert
-- intermediate steps (e.g. arrived) that incorrectly blocked manual complete.

CREATE OR REPLACE FUNCTION public.seller_complete_order_without_otp(_order_id uuid)
RETURNS TABLE(
  order_id uuid,
  new_status order_status,
  already_complete boolean,
  completion_method text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller_id uuid := auth.uid();
  _order RECORD;
  _assignment RECORD;
  _current_sort int;
  _immediate RECORD;
  _next_step RECORD;
  _txn_type text;
  _parent_group text;
  _prep_at timestamptz;
  _old_status text;
  _otp_type text;
BEGIN
  IF _caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT
    o.id,
    o.status,
    o.seller_id,
    o.society_id,
    o.transaction_type,
    o.fulfillment_type,
    o.order_type,
    o.scheduled_date,
    o.payment_status,
    o.completion_method,
    o.preparation_start_at,
    o.scheduled_fulfillment_at,
    sp.user_id AS seller_user_id,
    sp.primary_group
  INTO _order
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF _order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF _order.seller_user_id IS DISTINCT FROM _caller_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.status::text IN ('cancelled', 'rejected', 'failed', 'returned', 'no_show') THEN
    RAISE EXCEPTION 'A cancelled or closed order cannot be completed';
  END IF;

  IF lower(COALESCE(_order.payment_status, '')) IN ('refunded', 'refund_pending') THEN
    RAISE EXCEPTION 'A refunded order cannot be completed';
  END IF;

  IF _order.status::text IN ('delivered', 'completed', 'buyer_received') THEN
    RETURN QUERY SELECT _order_id, _order.status::order_status, true, _order.completion_method;
    RETURN;
  END IF;

  IF _order.scheduled_date IS NOT NULL THEN
    _prep_at := _order.preparation_start_at;
    IF _prep_at IS NULL AND _order.scheduled_fulfillment_at IS NOT NULL THEN
      _prep_at := _order.scheduled_fulfillment_at - interval '60 minutes';
    END IF;
    IF _prep_at IS NOT NULL AND now() < _prep_at THEN
      RAISE EXCEPTION 'Scheduled fulfillment is not open yet. This order cannot be completed until the preparation window starts.';
    END IF;
  END IF;

  _parent_group := COALESCE(resolve_transition_parent_group(_order.primary_group), 'default');
  _txn_type := COALESCE(_order.transaction_type, 'self_fulfillment');

  SELECT csf.sort_order INTO _current_sort
  FROM public.category_status_flows csf
  WHERE csf.transaction_type = _txn_type
    AND csf.parent_group = _parent_group
    AND csf.status_key = _order.status::text
  LIMIT 1;

  IF _current_sort IS NULL THEN
    SELECT csf.sort_order INTO _current_sort
    FROM public.category_status_flows csf
    WHERE csf.transaction_type = _txn_type
      AND csf.parent_group = 'default'
      AND csf.status_key = _order.status::text
    LIMIT 1;
    _parent_group := 'default';
  END IF;

  IF _current_sort IS NULL THEN
    RAISE EXCEPTION 'Cannot find current step for status %', _order.status;
  END IF;

  SELECT * INTO _immediate
  FROM public.category_status_flows csf
  WHERE csf.transaction_type = _txn_type
    AND csf.parent_group = _parent_group
    AND csf.sort_order > _current_sort
    AND NOT csf.is_deprecated
  ORDER BY csf.sort_order ASC
  LIMIT 1;

  IF _immediate.id IS NULL THEN
    RETURN QUERY SELECT _order_id, _order.status::order_status, true, _order.completion_method;
    RETURN;
  END IF;

  -- Prefer the next completion status ahead (on_the_way → delivered even if
  -- linear flow lists arrived in between).
  SELECT * INTO _next_step
  FROM public.category_status_flows csf
  WHERE csf.transaction_type = _txn_type
    AND csf.parent_group = _parent_group
    AND csf.sort_order > _current_sort
    AND NOT csf.is_deprecated
    AND csf.status_key IN ('delivered', 'buyer_received', 'completed')
  ORDER BY
    CASE csf.status_key WHEN 'delivered' THEN 1 WHEN 'buyer_received' THEN 2 ELSE 3 END,
    csf.sort_order ASC
  LIMIT 1;

  IF _next_step.id IS NULL THEN
    _otp_type := COALESCE(_immediate.otp_type, '');
    IF _otp_type IN ('delivery', 'generic')
       OR _immediate.status_key IN ('delivered', 'buyer_received', 'completed') THEN
      _next_step := _immediate;
    ELSE
      RAISE EXCEPTION 'This order is not eligible for completion without OTP';
    END IF;
  END IF;

  _old_status := _order.status::text;

  PERFORM set_config('app.otp_verified', 'true', true);
  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE public.orders
  SET
    status = _next_step.status_key::order_status,
    completion_method = 'seller_manual',
    updated_at = now()
  WHERE orders.id = _order_id;

  SELECT * INTO _assignment
  FROM public.delivery_assignments
  WHERE delivery_assignments.order_id = _order_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF _assignment.id IS NOT NULL THEN
    UPDATE public.delivery_assignments
    SET
      status = _next_step.status_key,
      delivered_at = CASE
        WHEN _next_step.status_key IN ('delivered', 'completed', 'buyer_received') THEN COALESCE(delivered_at, now())
        ELSE delivered_at
      END,
      updated_at = now()
    WHERE delivery_assignments.id = _assignment.id;
  END IF;

  INSERT INTO public.audit_log (action, target_type, target_id, actor_id, society_id, metadata)
  VALUES (
    'seller_complete_order_without_otp',
    'order',
    _order_id,
    _caller_id,
    _order.society_id,
    jsonb_build_object(
      'completion_method', 'seller_manual',
      'old_status', _old_status,
      'new_status', _next_step.status_key,
      'completed_at', now()
    )
  );

  RETURN QUERY SELECT _order_id, _next_step.status_key::order_status, false, 'seller_manual'::text;
END;
$function$;

COMMENT ON FUNCTION public.seller_complete_order_without_otp(uuid) IS
  'Seller-only OTP-free completion. Looks ahead to delivered/buyer_received/completed so intermediate linear steps (e.g. arrived) do not block.';
