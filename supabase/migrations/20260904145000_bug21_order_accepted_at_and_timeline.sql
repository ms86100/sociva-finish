-- BUG-21: stamp seller accept time so cancelled-from-placed timelines
-- do not show a false "Seller accepted" step.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

COMMENT ON COLUMN public.orders.accepted_at IS
  'First time seller accepted/confirmed/scheduled the order. Used by scheduled timeline.';

-- Backfill from audit when we know accept/schedule happened
UPDATE public.orders o
SET accepted_at = a.created_at
FROM (
  SELECT DISTINCT ON (target_id)
    target_id,
    created_at
  FROM public.audit_log
  WHERE target_type = 'order'
    AND action IN ('order_status_accepted', 'order_status_confirmed', 'order_status_scheduled')
  ORDER BY target_id, created_at ASC
) a
WHERE o.id = a.target_id
  AND o.accepted_at IS NULL;

-- Also backfill live scheduled / post-accept statuses without audit rows
UPDATE public.orders
SET accepted_at = COALESCE(status_changed_at, updated_at, created_at)
WHERE accepted_at IS NULL
  AND status::text IN (
    'accepted', 'confirmed', 'scheduled',
    'preparing', 'in_progress', 'ready', 'picked_up', 'on_the_way',
    'at_gate', 'en_route', 'assigned', 'arrived', 'awaiting_cod_confirmation',
    'completed', 'delivered', 'buyer_received'
  );

CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id uuid,
  _new_status order_status,
  _rejection_reason text DEFAULT NULL::text
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_valid BOOLEAN;
  v_updated_id uuid;
  v_final_status order_status;
  v_target_status order_status;
  v_today_ist date;
BEGIN
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status, o.transaction_type,
         o.scheduled_date, o.scheduled_fulfillment_at, o.preparation_start_at,
         o.auto_cancel_at, o.auto_accepted, o.accepted_at,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_target_status := _new_status;
  v_today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  IF v_order.status = 'placed'::public.order_status
     AND COALESCE(v_order.auto_accepted, false) = false
     AND v_order.auto_cancel_at IS NOT NULL
     AND v_order.auto_cancel_at <= now()
     AND _new_status IN ('accepted', 'confirmed', 'scheduled', 'preparing') THEN
    RAISE EXCEPTION 'Seller response time expired — this order can no longer be accepted'
      USING ERRCODE = 'P0001';
  END IF;

  IF _new_status IN ('accepted', 'confirmed')
     AND v_order.scheduled_date IS NOT NULL
     AND v_order.scheduled_date > v_today_ist
     AND (v_order.preparation_start_at IS NULL OR v_order.preparation_start_at > now()) THEN
    v_target_status := 'scheduled';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := v_order.transaction_type;
  ELSE
    SELECT p.listing_type INTO v_listing_type
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = _order_id LIMIT 1;

    IF v_listing_type = 'contact_only' THEN v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning','events') THEN v_transaction_type := 'service_booking';
      ELSE v_transaction_type := 'request_service'; END IF;
    ELSIF v_order.order_type = 'booking' THEN v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery') THEN v_transaction_type := 'seller_delivery';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = v_target_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to %', v_order.status, v_target_status;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = v_target_status,
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      failure_owner = CASE
        WHEN v_target_status::text IN ('cancelled', 'rejected') THEN COALESCE(failure_owner, 'seller')
        ELSE failure_owner
      END,
      accepted_at = CASE
        WHEN v_order.accepted_at IS NOT NULL THEN v_order.accepted_at
        WHEN v_target_status::text IN ('accepted', 'confirmed', 'scheduled') THEN now()
        ELSE NULL
      END,
      updated_at = now(),
      auto_cancel_at = CASE
        WHEN v_target_status IN ('accepted', 'confirmed', 'scheduled', 'preparing', 'cancelled', 'rejected')
          THEN NULL
        ELSE auto_cancel_at
      END
  WHERE id = _order_id AND status = v_order.status
  RETURNING id, status INTO v_updated_id, v_final_status;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  IF v_order.status = 'placed'::public.order_status
     AND v_final_status IS DISTINCT FROM 'placed'::public.order_status THEN
    PERFORM public.clear_order_acceptance_expiry(_order_id);
  END IF;

  RETURN v_final_status;
END;
$function$;
