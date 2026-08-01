
-- ============================================================
-- Blocker 1: seller_advance_order RPC — enforces app.acting_as = 'seller'
-- ============================================================
CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id uuid,
  _new_status order_status,
  _rejection_reason text DEFAULT NULL
)
RETURNS void
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
BEGIN
  -- Fetch the order with seller context
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Verify the caller is the seller
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized — you are not the seller of this order';
  END IF;

  v_parent_group := COALESCE(v_order.primary_group, 'default');

  -- Resolve transaction_type (same logic as buyer_advance_order)
  SELECT p.listing_type INTO v_listing_type
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = _order_id
  LIMIT 1;

  IF v_listing_type = 'contact_only' THEN
    v_transaction_type := 'contact_enquiry';
  ELSIF v_order.order_type = 'enquiry' THEN
    IF v_parent_group IN ('classes', 'events') THEN
      v_transaction_type := 'service_booking';
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

  -- Cancellation: check if seller can cancel from this status
  IF _new_status::text = 'cancelled' THEN
    SELECT EXISTS (
      SELECT 1 FROM category_status_transitions
      WHERE from_status = v_order.status::text
        AND to_status = 'cancelled'
        AND allowed_actor = 'seller'
        AND (
          (parent_group = v_parent_group AND transaction_type = v_transaction_type)
          OR (parent_group = 'default' AND transaction_type = v_transaction_type)
        )
    ) INTO v_valid;

    IF NOT v_valid THEN
      RAISE EXCEPTION 'Seller cannot cancel from status %', v_order.status;
    END IF;

    PERFORM set_config('app.acting_as', 'seller', true);

    UPDATE orders
    SET status = _new_status,
        rejection_reason = COALESCE(_rejection_reason, rejection_reason),
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
    RETURN;
  END IF;

  -- Normal forward transition: validate
  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text
      AND to_status = _new_status::text
      AND (
        allowed_actor = 'seller'
        OR position('seller' IN allowed_actor) > 0
      )
      AND (
        (parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type)
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to %', v_order.status, _new_status;
  END IF;

  -- Set actor flag so the trigger knows who is acting
  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = _new_status,
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id
    AND status = v_order.status;
END;
$function$;

-- ============================================================
-- Blocker 3: Fix sync_delivery_to_order_status to use app.acting_as = 'delivery'
-- and dynamically map delivery statuses to order statuses via the workflow
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_delivery_to_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_target_order_status TEXT;
BEGIN
  -- Skip if status hasn't changed
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Terminal delivery statuses handled by OTP RPC — don't double-sync
  IF NEW.status IN ('delivered', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Fetch order context for workflow resolution
  SELECT o.id, o.status, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = NEW.order_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_parent_group := COALESCE(v_order.primary_group, 'default');

  -- Resolve transaction_type
  SELECT p.listing_type INTO v_listing_type
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = NEW.order_id
  LIMIT 1;

  IF v_listing_type = 'contact_only' THEN
    v_transaction_type := 'contact_enquiry';
  ELSIF v_order.order_type = 'enquiry' THEN
    IF v_parent_group IN ('classes', 'events') THEN
      v_transaction_type := 'service_booking';
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

  -- Find the order-level status that corresponds to this delivery status
  -- Look for is_transit steps in the workflow that match the delivery assignment status
  SELECT csf.status_key INTO v_target_order_status
  FROM category_status_flows csf
  WHERE csf.parent_group = v_parent_group
    AND csf.transaction_type = v_transaction_type
    AND csf.is_transit = true
    AND csf.status_key = NEW.status
  LIMIT 1;

  -- If no direct match, try common mappings (at_gate → on_the_way)
  IF v_target_order_status IS NULL AND NEW.status = 'at_gate' THEN
    SELECT csf.status_key INTO v_target_order_status
    FROM category_status_flows csf
    WHERE csf.parent_group = v_parent_group
      AND csf.transaction_type = v_transaction_type
      AND csf.is_transit = true
      AND csf.status_key = 'on_the_way'
    LIMIT 1;
  END IF;

  -- If we found a valid target, advance the order
  IF v_target_order_status IS NOT NULL AND v_target_order_status != v_order.status::text THEN
    PERFORM set_config('app.acting_as', 'delivery', true);
    UPDATE orders
    SET status = v_target_order_status::order_status,
        updated_at = now()
    WHERE id = NEW.order_id
      AND status = v_order.status;
  END IF;

  RETURN NEW;
END;
$$;
