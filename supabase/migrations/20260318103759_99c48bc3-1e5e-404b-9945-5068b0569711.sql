
-- Table to store APNs push tokens for Live Activities
CREATE TABLE public.live_activity_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid NOT NULL,
  push_token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, platform)
);

-- RLS
ALTER TABLE public.live_activity_tokens ENABLE ROW LEVEL SECURITY;

-- Users can manage their own tokens
CREATE POLICY "Users can insert own LA tokens"
  ON public.live_activity_tokens FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can select own LA tokens"
  ON public.live_activity_tokens FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own LA tokens"
  ON public.live_activity_tokens FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Service role needs full access for edge functions
CREATE POLICY "Service role full access LA tokens"
  ON public.live_activity_tokens FOR ALL
  USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER update_live_activity_tokens_updated_at
  BEFORE UPDATE ON public.live_activity_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enable realtime for cleanup coordination
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_activity_tokens;

-- Update the order status trigger to also invoke the LA APNs edge function
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
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT sp.business_name, sp.logo_url INTO v_seller_name, v_seller_logo
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  -- Check if this status has silent_push enabled
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

  -- Enqueue push notification (existing behavior)
  INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
  VALUES (
    NEW.buyer_id, 'order', v_title, v_body,
    '/orders/' || NEW.id::text,
    jsonb_build_object(
      'orderId', NEW.id::text,
      'status', NEW.status::text,
      'type', 'order_status',
      'silent_push', COALESCE(v_silent, false),
      'image_url', COALESCE(v_seller_logo, '')
    )
  );

  -- APNs Push-to-Live-Activity: if a LA token exists for this order, send server-side update
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

  -- Clean up LA token on terminal statuses
  IF NEW.status IN ('delivered', 'completed', 'cancelled', 'no_show', 'failed') THEN
    DELETE FROM public.live_activity_tokens WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
