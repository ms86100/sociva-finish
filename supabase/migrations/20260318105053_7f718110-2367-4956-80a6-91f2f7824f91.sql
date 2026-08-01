
-- Phase 1A: Idempotency guard on notification trigger
-- Use existing reference_path + payload->>'status' for dedup
CREATE INDEX IF NOT EXISTS idx_notification_queue_dedup 
ON public.notification_queue (reference_path, created_at DESC)
WHERE reference_path IS NOT NULL;

-- Update trigger with idempotency check
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

  -- Idempotency: skip if same order+status was queued in last 30 seconds
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
      (SELECT cc.parent_group FROM public.category_config cc WHERE cc.category::text = NEW.category),
      'marketplace'
    )
    AND csf.transaction_type = COALESCE(
      (SELECT cc.transaction_type FROM public.category_config cc WHERE cc.category::text = NEW.category),
      'buy'
    )
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
    WHEN 'on_the_way' THEN
      v_title := '🚗 On The Way';
      v_body := COALESCE(v_seller_name, 'The service provider') || ' is on the way to you.';
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

  -- APNs Push-to-Live-Activity
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
