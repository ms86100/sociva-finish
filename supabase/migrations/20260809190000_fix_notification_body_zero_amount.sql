-- Fix: notification body showed "Rs 0.00" for enquiry/catalog orders
-- where total_amount is not yet set at order creation time.
--
-- Only embed the amount in the body when it is greater than zero.

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
    IF NEW.status = 'payment_pending' THEN RETURN NEW; END IF;
    _notify_status := NEW.status;
    _notify_amount := NEW.total_amount;
  ELSIF TG_OP = 'UPDATE' THEN
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
      IF _notify_amount > 0 THEN
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || _notify_amount || '. Auto-accepted — start preparing!';
      ELSE
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed a new order. Auto-accepted — start preparing!';
      END IF;
    ELSE
      _seller_title := '🔔 New Order Received';
      IF _notify_amount > 0 THEN
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || _notify_amount || '. Tap to accept!';
      ELSE
        _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed a new order. Tap to accept!';
      END IF;
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
