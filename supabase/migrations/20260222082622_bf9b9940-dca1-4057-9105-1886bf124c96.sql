
-- Trigger function: on order status change, insert into notification_queue
CREATE OR REPLACE FUNCTION public.enqueue_order_status_notification()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _seller_name text;
  _buyer_name text;
  _short_order_id text;
  _notif_title text;
  _notif_body text;
  _target_user_id uuid;
BEGIN
  -- Only fire on actual status changes
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _short_order_id := LEFT(NEW.id::text, 8);

  -- Get seller user_id and name
  SELECT sp.user_id, sp.business_name
  INTO _seller_user_id, _seller_name
  FROM seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  -- Get buyer name
  SELECT p.name INTO _buyer_name
  FROM profiles p
  WHERE p.id = NEW.buyer_id;

  _seller_name := COALESCE(_seller_name, 'Seller');
  _buyer_name := COALESCE(_buyer_name, 'Customer');

  -- Seller notifications (new order placed)
  IF NEW.status = 'placed' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _seller_user_id,
      '🆕 New Order Received!',
      _buyer_name || ' placed an order. Tap to view and accept.',
      'order',
      '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status)
    );
  END IF;

  -- Seller notification for cancellation
  IF NEW.status = 'cancelled' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _seller_user_id,
      '❌ Order Cancelled',
      'Order #' || _short_order_id || ' from ' || _buyer_name || ' was cancelled.',
      'order',
      '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status)
    );
  END IF;

  -- Buyer notifications
  CASE NEW.status
    WHEN 'accepted' THEN
      _notif_title := '✅ Order Accepted!';
      _notif_body := _seller_name || ' accepted your order and will start preparing it.';
    WHEN 'preparing' THEN
      _notif_title := '👨‍🍳 Order Being Prepared';
      _notif_body := _seller_name || ' is now preparing your order.';
    WHEN 'ready' THEN
      _notif_title := '🎉 Order Ready!';
      _notif_body := 'Your order from ' || _seller_name || ' is ready for pickup!';
    WHEN 'picked_up' THEN
      _notif_title := '📦 Order Picked Up';
      _notif_body := 'Your order from ' || _seller_name || ' has been picked up.';
    WHEN 'delivered' THEN
      _notif_title := '🚚 Order Delivered';
      _notif_body := 'Your order from ' || _seller_name || ' has been delivered!';
    WHEN 'completed' THEN
      _notif_title := '⭐ Order Completed';
      _notif_body := 'Your order from ' || _seller_name || ' is complete. Leave a review!';
    WHEN 'cancelled' THEN
      _notif_title := '❌ Order Cancelled';
      _notif_body := 'Your order from ' || _seller_name || ' was cancelled.';
    WHEN 'quoted' THEN
      _notif_title := '💰 Quote Received';
      _notif_body := _seller_name || ' sent you a price quote for your enquiry.';
    WHEN 'scheduled' THEN
      _notif_title := '📅 Booking Confirmed';
      _notif_body := _seller_name || ' confirmed your booking.';
    ELSE
      _notif_title := NULL;
  END CASE;

  IF _notif_title IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      NEW.buyer_id,
      _notif_title,
      _notif_body,
      'order',
      '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_enqueue_order_notification ON orders;
CREATE TRIGGER trg_enqueue_order_notification
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_order_status_notification();

-- Also fire on INSERT for 'placed' status (new orders)
CREATE OR REPLACE FUNCTION public.enqueue_order_placed_notification()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name text;
BEGIN
  IF NEW.status != 'placed' THEN
    RETURN NEW;
  END IF;

  SELECT sp.user_id INTO _seller_user_id
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  SELECT p.name INTO _buyer_name
  FROM profiles p WHERE p.id = NEW.buyer_id;

  IF _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _seller_user_id,
      '🆕 New Order Received!',
      COALESCE(_buyer_name, 'Customer') || ' placed an order. Tap to view and accept.',
      'order',
      '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', 'placed')
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_order_placed_notification ON orders;
CREATE TRIGGER trg_enqueue_order_placed_notification
  AFTER INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_order_placed_notification();
