-- Fix: seller push notification showed Rs 0.00 for Razorpay orders
--
-- Root cause: trigger fired on INSERT including payment_pending rows where
-- total_amount=0 (Razorpay orders start as payment_pending before being
-- confirmed). The notification was sent before the amount was set.
--
-- Fix:
--   1. Skip INSERT notifications for payment_pending orders.
--   2. Fire on UPDATE OF status: payment_pending → placed/preparing sends
--      the notification with the correct total_amount.

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name text;
  _is_auto_accepted boolean;
  _seller_title text;
  _seller_body text;
  _notify_status text;
  _notify_amount numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Skip payment_pending inserts: Razorpay orders start here with total_amount=0.
    -- The notification fires on the subsequent UPDATE to placed/preparing instead.
    IF NEW.status = 'payment_pending' THEN RETURN NEW; END IF;
    _notify_status := NEW.status;
    _notify_amount := NEW.total_amount;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only fire when transitioning out of payment_pending to placed or preparing.
    IF OLD.status != 'payment_pending' THEN RETURN NEW; END IF;
    IF NEW.status NOT IN ('placed', 'preparing') THEN RETURN NEW; END IF;
    _notify_status := NEW.status;
    _notify_amount := NEW.total_amount;
  ELSE
    RETURN NEW;
  END IF;

  _is_auto_accepted := (_notify_status = 'preparing');

  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  SELECT name INTO _buyer_name FROM profiles WHERE id = NEW.buyer_id;

  IF _seller_user_id IS NOT NULL THEN
    IF _is_auto_accepted THEN
      _seller_title := '✅ Order Auto-Accepted';
      _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || COALESCE(_notify_amount, 0) || '. Auto-accepted — start preparing!';
    ELSE
      _seller_title := '🔔 New Order Received';
      _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || COALESCE(_notify_amount, 0) || '. Tap to accept!';
    END IF;

    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _seller_user_id,
      _seller_title,
      _seller_body,
      'order',
      '/seller/orders/' || NEW.id,
      jsonb_build_object(
        'order_id', NEW.id,
        'orderId', NEW.id,
        'buyer_name', _buyer_name,
        'total', _notify_amount,
        'type', NEW.order_type,
        'auto_accepted', _is_auto_accepted,
        'target_role', 'seller',
        'status', _notify_status,
        'action', 'view_order',
        'reference_path', '/orders/' || NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification ON public.orders;
CREATE TRIGGER trg_enqueue_new_order_notification
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION fn_enqueue_new_order_notification();
