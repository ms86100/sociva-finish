
-- Gap 3: Sync order status → delivery_assignments.status for seller-delivery orders
-- The existing sync_delivery_to_order_status syncs delivery_assignments → orders.
-- We need the REVERSE: when orders.status changes to on_the_way/delivered, update delivery_assignments.status.

CREATE OR REPLACE FUNCTION public.sync_order_to_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Only sync for seller-handled delivery orders
  IF COALESCE(NEW.delivery_handled_by, '') != 'seller' THEN
    RETURN NEW;
  END IF;

  -- Sync relevant statuses to delivery_assignments
  IF NEW.status IN ('on_the_way', 'delivered') THEN
    UPDATE public.delivery_assignments
    SET status = NEW.status,
        updated_at = now(),
        delivered_at = CASE WHEN NEW.status = 'delivered' THEN now() ELSE delivered_at END
    WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_to_delivery_assignment ON public.orders;
CREATE TRIGGER trg_sync_order_to_delivery_assignment
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_order_to_delivery_assignment();

-- Gap 5: Notify seller when buyer confirms delivery (order → completed)
-- Extend fn_enqueue_order_status_notification to also notify seller on 'completed'
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_name text;
  v_seller_logo text;
  v_seller_user_id uuid;
  v_title text;
  v_body text;
  v_silent boolean := false;
  v_la_token text;
  v_already_queued boolean;
  v_ref_path text;
  v_buyer_name text;
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

  SELECT sp.business_name, sp.logo_url, sp.user_id INTO v_seller_name, v_seller_logo, v_seller_user_id
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

  -- Buyer notification
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

  -- Insert buyer notification
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

  -- Gap 5: Notify seller when order is completed (buyer confirmed delivery)
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

  -- Live Activity APNs update
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
