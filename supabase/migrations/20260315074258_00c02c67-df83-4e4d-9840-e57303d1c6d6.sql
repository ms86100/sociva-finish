
-- 1. Add notification columns to category_status_flows
ALTER TABLE public.category_status_flows
  ADD COLUMN IF NOT EXISTS notify_buyer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_title text,
  ADD COLUMN IF NOT EXISTS notification_body text,
  ADD COLUMN IF NOT EXISTS notification_action text;

-- 2. Backfill existing workflows with current hardcoded notification data
UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '✅ Order Accepted!',
  notification_body = '{seller_name} has accepted your order.'
WHERE status_key = 'accepted';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '👨‍🍳 Being Prepared',
  notification_body = 'Your order is being prepared by {seller_name}.'
WHERE status_key = 'preparing';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '🎉 Order Ready!',
  notification_body = 'Your order from {seller_name} is ready for pickup!'
WHERE status_key = 'ready';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '📦 Order Picked Up',
  notification_body = 'Your order has been picked up for delivery.'
WHERE status_key = 'picked_up';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '🚚 Order Delivered!',
  notification_body = 'Your order from {seller_name} has been delivered.'
WHERE status_key = 'delivered';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '⭐ Order Completed',
  notification_body = 'Your order is complete. Leave a review for {seller_name}!',
  notification_action = 'Rate Order'
WHERE status_key = 'completed';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '❌ Order Cancelled',
  notification_body = 'Your order from {seller_name} has been cancelled.'
WHERE status_key = 'cancelled';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '💰 Quote Received',
  notification_body = '{seller_name} sent you a price quote.'
WHERE status_key = 'quoted';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '📅 Booking Confirmed',
  notification_body = 'Your booking with {seller_name} has been confirmed.'
WHERE status_key = 'scheduled';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '✅ Appointment Confirmed',
  notification_body = 'Your appointment with {seller_name} is confirmed.'
WHERE status_key = 'confirmed';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '🚗 On The Way',
  notification_body = '{seller_name} is on the way to you.'
WHERE status_key = 'on_the_way';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '📍 Arrived',
  notification_body = '{seller_name} has arrived.'
WHERE status_key = 'arrived';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '🔧 Service In Progress',
  notification_body = 'Your service with {seller_name} is in progress.'
WHERE status_key = 'in_progress';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '🔄 Appointment Rescheduled',
  notification_body = 'Your appointment with {seller_name} has been rescheduled.'
WHERE status_key = 'rescheduled';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '⚠️ No Show',
  notification_body = 'You were marked as a no-show for your appointment with {seller_name}.'
WHERE status_key = 'no_show';

UPDATE public.category_status_flows SET notify_buyer = true,
  notification_title = '📋 Booking Requested',
  notification_body = 'Your service booking with {seller_name} has been submitted.'
WHERE status_key = 'requested';

-- 3. Replace the trigger function with workflow-driven version
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_seller_name text;
  v_parent_group text;
  v_transaction_type text;
  v_title text;
  v_body text;
  v_action text;
  v_payload jsonb;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Get seller name and parent_group
  SELECT sp.business_name, COALESCE(sp.primary_group, 'default')
  INTO v_seller_name, v_parent_group
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  v_seller_name := COALESCE(v_seller_name, 'The seller');

  -- Resolve transaction_type from order_type and fulfillment_type
  IF NEW.order_type = 'enquiry' THEN
    IF v_parent_group IN ('classes', 'events') THEN
      v_transaction_type := 'book_slot';
    ELSE
      v_transaction_type := 'request_service';
    END IF;
  ELSIF NEW.order_type = 'booking' THEN
    v_transaction_type := 'service_booking';
  ELSIF NEW.fulfillment_type IN ('self_pickup', 'seller_delivery') THEN
    v_transaction_type := 'self_fulfillment';
  ELSE
    v_transaction_type := 'cart_purchase';
  END IF;

  -- Look up notification config from workflow step (specific parent_group first)
  SELECT csf.notification_title, csf.notification_body, csf.notification_action
  INTO v_title, v_body, v_action
  FROM public.category_status_flows csf
  WHERE csf.parent_group = v_parent_group
    AND csf.transaction_type = v_transaction_type
    AND csf.status_key = NEW.status
    AND csf.notify_buyer = true
    AND csf.notification_title IS NOT NULL;

  -- Fallback to 'default' parent_group if no match
  IF v_title IS NULL THEN
    SELECT csf.notification_title, csf.notification_body, csf.notification_action
    INTO v_title, v_body, v_action
    FROM public.category_status_flows csf
    WHERE csf.parent_group = 'default'
      AND csf.transaction_type = v_transaction_type
      AND csf.status_key = NEW.status
      AND csf.notify_buyer = true
      AND csf.notification_title IS NOT NULL;
  END IF;

  -- No notification configured for this step
  IF v_title IS NULL THEN
    RETURN NEW;
  END IF;

  -- Replace {seller_name} placeholder
  v_title := replace(v_title, '{seller_name}', v_seller_name);
  v_body := replace(COALESCE(v_body, ''), '{seller_name}', v_seller_name);

  -- Build payload
  v_payload := jsonb_build_object(
    'orderId', NEW.id::text,
    'status', NEW.status::text,
    'type', 'order_status'
  );
  IF v_action IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('action', v_action);
  END IF;

  INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
  VALUES (
    NEW.buyer_id, 'order', v_title, v_body,
    '/orders/' || NEW.id::text,
    v_payload
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$fn$;
