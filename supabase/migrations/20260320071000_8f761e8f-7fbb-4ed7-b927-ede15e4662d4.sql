
-- 1. Add is_deprecated column to category_status_flows
ALTER TABLE public.category_status_flows ADD COLUMN is_deprecated BOOLEAN NOT NULL DEFAULT false;

-- 2. Update fn_enqueue_order_status_notification to handle contact_enquiry
-- Add 'contacted' and 'responded' notification cases via the existing status_key mapping
-- The CASE for transaction_type resolution needs contact_enquiry support
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_name text;
  v_seller_logo_url text;
  v_seller_user_id uuid;
  v_title text;
  v_body text;
  v_silent boolean := false;
  v_already_queued boolean;
  v_ref_path text;
  v_buyer_name text;
  v_is_terminal boolean := false;
  v_parent_group text;
  v_listing_type text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_ref_path := '/orders/' || NEW.id::text;

  SELECT EXISTS (
    SELECT 1 FROM public.notification_queue
    WHERE reference_path = v_ref_path
      AND payload->>'status' = NEW.status::text
      AND created_at > now() - interval '30 seconds'
  ) INTO v_already_queued;

  IF v_already_queued THEN
    RAISE NOTICE 'Skipping duplicate notification for order % status %', NEW.id, NEW.status;
    RETURN NEW;
  END IF;

  SELECT sp.business_name, sp.profile_image_url, sp.user_id, sp.primary_group
  INTO v_seller_name, v_seller_logo_url, v_seller_user_id, v_parent_group
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  v_parent_group := COALESCE(v_parent_group, 'default');

  -- Resolve listing_type from the order's product to detect contact_only
  SELECT cc.transaction_type INTO v_listing_type
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  JOIN public.category_config cc ON cc.category = p.category
  WHERE oi.order_id = NEW.id
  LIMIT 1;

  SELECT csf.silent_push INTO v_silent
  FROM public.category_status_flows csf
  WHERE csf.status_key = NEW.status
    AND csf.parent_group = COALESCE(v_parent_group, 'default')
    AND csf.transaction_type = CASE
      WHEN v_listing_type = 'contact_only' THEN 'contact_enquiry'
      WHEN NEW.order_type = 'enquiry' AND v_parent_group IN ('classes', 'events') THEN 'service_booking'
      WHEN NEW.order_type = 'enquiry' THEN 'request_service'
      WHEN NEW.order_type = 'booking' THEN 'service_booking'
      WHEN NEW.fulfillment_type = 'self_pickup' THEN 'self_fulfillment'
      WHEN NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN 'seller_delivery'
      WHEN NEW.fulfillment_type = 'seller_delivery' THEN 'seller_delivery'
      WHEN NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN 'cart_purchase'
      ELSE 'self_fulfillment'
    END
  LIMIT 1;

  CASE NEW.status
    WHEN 'accepted' THEN
      v_title := '✅ Order Accepted!';
      v_body := COALESCE(v_seller_name, 'The seller') || ' has accepted your order.';
    WHEN 'preparing' THEN
      v_title := '👨‍🍳 Being Prepared';
      v_body := 'Your order is being prepared by ' || COALESCE(v_seller_name, 'the seller') || '.';
    WHEN 'ready' THEN
      v_title := '🎉 Order Ready!';
      v_body := 'Your order from ' || COALESCE(v_seller_name, 'the seller') || ' is ready for pickup!';
    WHEN 'picked_up' THEN
      v_title := '📦 Order Picked Up';
      v_body := 'Your order has been picked up for delivery.';
    WHEN 'on_the_way' THEN
      v_title := '🚗 On The Way';
      v_body := COALESCE(v_seller_name, 'The seller') || ' is on the way to you.';
    WHEN 'delivered' THEN
      v_title := '🚚 Order Delivered!';
      v_body := 'Your order from ' || COALESCE(v_seller_name, 'the seller') || ' has been delivered.';
    WHEN 'completed' THEN
      v_title := '⭐ Order Completed';
      v_body := 'Your order is complete. Leave a review for ' || COALESCE(v_seller_name, 'the seller') || '!';
    WHEN 'cancelled' THEN
      v_title := '❌ Order Cancelled';
      v_body := 'Your order from ' || COALESCE(v_seller_name, 'the seller') || ' has been cancelled.';
    WHEN 'quoted' THEN
      v_title := '💰 Quote Received';
      v_body := COALESCE(v_seller_name, 'The seller') || ' sent you a price quote.';
    WHEN 'scheduled' THEN
      v_title := '📅 Booking Confirmed';
      v_body := 'Your booking with ' || COALESCE(v_seller_name, 'the seller') || ' has been confirmed.';
    WHEN 'confirmed' THEN
      v_title := '✅ Appointment Confirmed';
      v_body := 'Your appointment with ' || COALESCE(v_seller_name, 'the seller') || ' is confirmed.';
    WHEN 'arrived' THEN
      v_title := '📍 Arrived';
      v_body := COALESCE(v_seller_name, 'The service provider') || ' has arrived.';
    WHEN 'in_progress' THEN
      v_title := '🔧 Service In Progress';
      v_body := 'Your service with ' || COALESCE(v_seller_name, 'the seller') || ' is in progress.';
    WHEN 'rescheduled' THEN
      v_title := '🔄 Appointment Rescheduled';
      v_body := 'Your appointment with ' || COALESCE(v_seller_name, 'the seller') || ' has been rescheduled.';
    WHEN 'no_show' THEN
      v_title := '⚠️ No Show';
      v_body := 'You were marked as a no-show for your appointment with ' || COALESCE(v_seller_name, 'the seller') || '.';
    WHEN 'requested' THEN
      v_title := '📋 Booking Requested';
      v_body := 'Your booking request has been sent to ' || COALESCE(v_seller_name, 'the seller') || '.';
    WHEN 'enquired' THEN
      v_title := '📩 Enquiry Sent';
      v_body := 'Your enquiry has been sent to ' || COALESCE(v_seller_name, 'the seller') || '.';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
  VALUES (
    NEW.buyer_id, 'order', v_title, v_body,
    v_ref_path,
    jsonb_build_object(
      'orderId', NEW.id::text,
      'status', NEW.status::text,
      'type', 'order_status',
      'silent_push', COALESCE(v_silent, false),
      'image_url', COALESCE(v_seller_logo_url, ''),
      'seller_logo_url', COALESCE(v_seller_logo_url, '')
    )
  );

  IF NEW.status = 'completed' AND v_seller_user_id IS NOT NULL THEN
    SELECT p.name INTO v_buyer_name FROM public.profiles p WHERE p.id = NEW.buyer_id;
    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      v_seller_user_id, 'order', '✅ Delivery Confirmed',
      COALESCE(v_buyer_name, 'The buyer') || ' has confirmed receiving the order.',
      v_ref_path,
      jsonb_build_object(
        'orderId', NEW.id::text,
        'status', NEW.status::text,
        'type', 'order_status',
        'silent_push', false,
        'image_url', ''
      )
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.category_status_flows
    WHERE status_key = NEW.status AND is_terminal = true
  ) INTO v_is_terminal;

  IF NOT v_is_terminal AND NEW.status IN ('delivered', 'completed', 'cancelled', 'no_show', 'failed') THEN
    v_is_terminal := true;
  END IF;

  IF v_is_terminal THEN
    DELETE FROM public.live_activity_tokens WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 3. Update buyer_advance_order to handle contact_enquiry resolution
CREATE OR REPLACE FUNCTION public.buyer_advance_order(_order_id uuid, _new_status order_status)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_valid BOOLEAN;
  v_listing_type TEXT;
BEGIN
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

  v_parent_group := COALESCE(v_order.primary_group, 'default');

  -- Check if order is contact_only via its product's category_config
  SELECT cc.transaction_type INTO v_listing_type
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN category_config cc ON cc.category = p.category
  WHERE oi.order_id = _order_id
  LIMIT 1;

  -- Resolve transaction_type (mirrors client-side resolveTransactionType)
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

  UPDATE orders
  SET status = _new_status,
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id
    AND status = v_order.status;
END;
$function$;
