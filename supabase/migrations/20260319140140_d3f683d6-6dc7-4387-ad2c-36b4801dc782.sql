
-- Bug 1: Create buyer_advance_order RPC (SECURITY DEFINER) so buyers can advance order status
-- through DB-validated transitions without being blocked by RLS UPDATE policy.
CREATE OR REPLACE FUNCTION public.buyer_advance_order(
  _order_id UUID,
  _new_status order_status
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_valid BOOLEAN;
BEGIN
  -- 1. Fetch order and verify caller is the buyer
  SELECT o.id, o.status, o.buyer_id, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized — you are not the buyer of this order';
  END IF;

  -- 2. Resolve parent_group
  v_parent_group := COALESCE(v_order.primary_group, 'default');

  -- 3. Resolve transaction_type (mirrors client-side resolveTransactionType)
  IF v_order.order_type = 'enquiry' THEN
    IF v_parent_group IN ('classes', 'events') THEN
      v_transaction_type := 'book_slot';
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

  -- 4. Validate transition against category_status_transitions (with default fallback)
  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text
      AND to_status = _new_status::text
      AND allowed_actor = 'buyer'
      AND (
        (parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type)
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid buyer transition from % to %', v_order.status, _new_status;
  END IF;

  -- 5. Perform the update
  UPDATE orders
  SET status = _new_status,
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id
    AND status = v_order.status;
END;
$$;

-- Bug 3: Add seller fallback transition for cart_purchase ready state
-- This allows sellers to advance orders past 'ready' when no platform delivery system exists
INSERT INTO category_status_transitions (parent_group, transaction_type, from_status, to_status, allowed_actor)
SELECT 'default', 'cart_purchase', 'ready', 'picked_up', 'seller'
WHERE NOT EXISTS (
  SELECT 1 FROM category_status_transitions
  WHERE parent_group = 'default' AND transaction_type = 'cart_purchase'
    AND from_status = 'ready' AND to_status = 'picked_up' AND allowed_actor = 'seller'
);
