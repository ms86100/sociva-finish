
-- ============================================================
-- Gap A: Create seller_delivery transaction type
-- Gap D: Add auto_complete_at column to orders
-- ============================================================

-- 1. Add auto_complete_at column
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS auto_complete_at timestamptz;

-- 2. Insert seller_delivery flow steps into category_status_flows (default parent_group)
INSERT INTO public.category_status_flows 
  (parent_group, transaction_type, status_key, sort_order, actor, is_terminal, display_label, color, icon, buyer_hint, seller_hint, notify_buyer, notification_title, notification_body, notification_action, notify_seller, seller_notification_title, seller_notification_body, silent_push)
VALUES
  ('default', 'seller_delivery', 'placed',     10, 'buyer',  false, 'Placed',      'bg-blue-100 text-blue-700',    'ShoppingCart', 'Your order has been placed. Waiting for seller to accept.', 'New order received. Review items and accept or reject promptly.', false, NULL, NULL, NULL, true, '🆕 New Order Received!', NULL, false),
  ('default', 'seller_delivery', 'accepted',   20, 'seller', false, 'Accepted',    'bg-green-100 text-green-700',  'ThumbsUp',     'Your order has been accepted and will be prepared soon.', 'You accepted this order. Begin preparation when ready.', true, '✅ Order Accepted!', '{seller_name} has accepted your order.', NULL, false, NULL, NULL, false),
  ('default', 'seller_delivery', 'preparing',  30, 'seller', false, 'Preparing',   'bg-yellow-100 text-yellow-700','ChefHat',      'Your order is being prepared.', 'Order is being prepared. Mark as ready when complete.', true, '👨‍🍳 Being Prepared', 'Your order is being prepared by {seller_name}.', NULL, false, NULL, NULL, true),
  ('default', 'seller_delivery', 'ready',      40, 'seller', false, 'Ready',       'bg-emerald-100 text-emerald-700','Package',    'Your order is ready for delivery!', 'Order is ready. Pick it up and head to the buyer.', true, '🎉 Order Ready!', 'Your order from {seller_name} is ready!', NULL, false, NULL, NULL, false),
  ('default', 'seller_delivery', 'picked_up',  50, 'seller', false, 'Picked Up',   'bg-purple-100 text-purple-700','Truck',        'Your order has been picked up by the seller.', 'You picked up the order. Start heading to the buyer.', true, '📦 Order Picked Up', 'Your order has been picked up for delivery.', NULL, false, NULL, NULL, true),
  ('default', 'seller_delivery', 'on_the_way', 60, 'seller', false, 'On the Way',  'bg-indigo-100 text-indigo-700','Navigation',   'Your order is on the way!', 'You are on your way. The buyer can track your location.', true, '🚗 On The Way', '{seller_name} is on the way to you.', NULL, false, NULL, NULL, true),
  ('default', 'seller_delivery', 'delivered',  70, 'seller', false, 'Delivered',    'bg-green-100 text-green-800',  'CheckCircle',  'Your order has been delivered! Please confirm receipt.', 'Order delivered. Waiting for buyer confirmation.', true, '🚚 Order Delivered!', 'Your order from {seller_name} has been delivered.', NULL, false, NULL, NULL, false),
  ('default', 'seller_delivery', 'completed',  80, 'buyer',  true,  'Completed',   'bg-green-100 text-green-800',  'CheckCircle2', 'Order completed. Leave a review!', 'Order completed and settled. Check your earnings dashboard.', true, '⭐ Order Completed', 'Your order is complete. Leave a review for {seller_name}!', 'Rate Order', false, NULL, NULL, false),
  ('default', 'seller_delivery', 'cancelled',  90, 'admin',  true,  'Cancelled',   'bg-red-100 text-red-700',      'XCircle',      'This order has been cancelled.', 'This order was cancelled. Check cancellation reason for details.', true, '❌ Order Cancelled', 'Your order from {seller_name} has been cancelled.', NULL, true, '❌ Order Cancelled', NULL, false)
ON CONFLICT DO NOTHING;

-- 3. Insert seller_delivery transitions
INSERT INTO public.category_status_transitions
  (parent_group, transaction_type, from_status, to_status, allowed_actor)
VALUES
  -- placed transitions
  ('default', 'seller_delivery', 'placed', 'accepted', 'seller'),
  ('default', 'seller_delivery', 'placed', 'cancelled', 'buyer'),
  ('default', 'seller_delivery', 'placed', 'cancelled', 'seller'),
  ('default', 'seller_delivery', 'placed', 'cancelled', 'admin'),
  -- accepted transitions
  ('default', 'seller_delivery', 'accepted', 'preparing', 'seller'),
  ('default', 'seller_delivery', 'accepted', 'cancelled', 'seller'),
  ('default', 'seller_delivery', 'accepted', 'cancelled', 'admin'),
  -- preparing transitions
  ('default', 'seller_delivery', 'preparing', 'ready', 'seller'),
  ('default', 'seller_delivery', 'preparing', 'cancelled', 'admin'),
  -- ready transitions
  ('default', 'seller_delivery', 'ready', 'picked_up', 'seller'),
  ('default', 'seller_delivery', 'ready', 'cancelled', 'admin'),
  -- picked_up transitions
  ('default', 'seller_delivery', 'picked_up', 'on_the_way', 'seller'),
  ('default', 'seller_delivery', 'picked_up', 'cancelled', 'admin'),
  -- on_the_way transitions
  ('default', 'seller_delivery', 'on_the_way', 'delivered', 'seller'),
  ('default', 'seller_delivery', 'on_the_way', 'cancelled', 'admin'),
  -- delivered transitions
  ('default', 'seller_delivery', 'delivered', 'completed', 'buyer'),
  ('default', 'seller_delivery', 'delivered', 'completed', 'system')
ON CONFLICT DO NOTHING;

-- 4. Update validate_order_status_transition to route seller_delivery
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _parent_group text;
  _txn_type text;
  _valid boolean;
  _actors text[];
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
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

  IF NEW.order_type = 'enquiry' THEN
    IF _parent_group IN ('classes', 'events') THEN
      _txn_type := 'book_slot';
    ELSE
      _txn_type := 'request_service';
    END IF;
  ELSIF NEW.order_type = 'booking' THEN
    _txn_type := 'service_booking';
  ELSIF NEW.fulfillment_type IN ('self_pickup') THEN
    _txn_type := 'self_fulfillment';
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN
    _txn_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'seller_delivery' THEN
    _txn_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
    _txn_type := 'cart_purchase';
  ELSE
    _txn_type := 'self_fulfillment';
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
    RAISE EXCEPTION 'Invalid status transition from "%" to "%"', OLD.status, NEW.status;
  END IF;

  SELECT array_agg(DISTINCT cst.allowed_actor) INTO _actors
  FROM public.category_status_transitions cst
  WHERE (cst.parent_group = COALESCE(_parent_group, 'default') OR cst.parent_group = 'default')
    AND cst.transaction_type = _txn_type
    AND cst.from_status = OLD.status::text
    AND cst.to_status = NEW.status::text;

  IF _actors IS NOT NULL
     AND NOT ('seller' = ANY(_actors) OR 'buyer' = ANY(_actors) OR 'admin' = ANY(_actors))
     AND ('delivery' = ANY(_actors) OR 'system' = ANY(_actors)) THEN
    IF coalesce(current_setting('app.delivery_sync', true), '') != 'true'
       AND current_setting('role', true) != 'service_role' THEN
      RAISE EXCEPTION 'Status transition to "%" can only be performed by the delivery/system', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Update fn_enqueue_order_status_notification to route seller_delivery
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_name text;
  v_seller_logo text;
  v_title text;
  v_body text;
  v_silent boolean := false;
  v_la_token text;
  v_already_queued boolean;
  v_ref_path text;
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

  SELECT sp.business_name, sp.logo_url INTO v_seller_name, v_seller_logo
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  SELECT csf.silent_push INTO v_silent
  FROM public.category_status_flows csf
  WHERE csf.status_key = NEW.status
    AND csf.parent_group = COALESCE(
      (SELECT sp2.primary_group FROM public.seller_profiles sp2 WHERE sp2.id = NEW.seller_id),
      'default'
    )
    AND csf.transaction_type = CASE
      WHEN NEW.order_type = 'enquiry' AND COALESCE((SELECT sp3.primary_group FROM public.seller_profiles sp3 WHERE sp3.id = NEW.seller_id), '') IN ('classes', 'events') THEN 'book_slot'
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
      v_body := 'Your service booking with ' || COALESCE(v_seller_name, 'the seller') || ' has been submitted.';
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
      'image_url', COALESCE(v_seller_logo, '')
    )
  );

  SELECT push_token INTO v_la_token
  FROM public.live_activity_tokens
  WHERE order_id = NEW.id AND platform = 'ios'
  LIMIT 1;

  IF v_la_token IS NOT NULL THEN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
             || '/functions/v1/update-live-activity-apns',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'order_id', NEW.id::text,
        'status', NEW.status::text,
        'push_token', v_la_token,
        'seller_name', COALESCE(v_seller_name, ''),
        'seller_logo', COALESCE(v_seller_logo, '')
      )
    );
  END IF;

  IF NEW.status IN ('delivered', 'completed', 'cancelled', 'no_show', 'failed') THEN
    DELETE FROM public.live_activity_tokens WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 6. Set auto_complete_at when order transitions to 'delivered'
CREATE OR REPLACE FUNCTION public.fn_set_auto_complete_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'delivered' THEN
    NEW.auto_complete_at := now() + interval '30 minutes';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'cancelled') THEN
    NEW.auto_complete_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_auto_complete_at ON public.orders;
CREATE TRIGGER trg_set_auto_complete_at
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_auto_complete_at();
