-- seller_advance_order: heal stamp before transition check; persist healed stamp;
-- RETURNS order_status (matches frontend types / audit_p1 contract).
DROP FUNCTION IF EXISTS public.seller_advance_order(uuid, order_status, text);

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
BEGIN
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status, o.transaction_type,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := public.heal_order_transaction_type(
      v_order.transaction_type,
      v_order.fulfillment_type,
      v_order.delivery_handled_by
    );
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
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery')
         AND COALESCE(v_order.delivery_handled_by, 'seller') = 'seller' THEN
      v_transaction_type := 'seller_delivery';
    ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
      v_transaction_type := 'cart_purchase';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = _new_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to % (workflow %)',
      v_order.status, _new_status, v_transaction_type;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = _new_status,
      transaction_type = COALESCE(v_transaction_type, transaction_type),
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      failure_owner = CASE
        WHEN _new_status::text IN ('cancelled', 'rejected') THEN COALESCE(failure_owner, 'seller')
        ELSE failure_owner
      END,
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id AND status = v_order.status
  RETURNING id, status INTO v_updated_id, v_final_status;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_final_status;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seller_advance_order(uuid, order_status, text) TO authenticated, service_role;

