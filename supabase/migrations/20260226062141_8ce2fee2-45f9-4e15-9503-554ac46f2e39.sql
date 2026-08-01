
CREATE OR REPLACE FUNCTION public.enqueue_order_placed_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name text;
  _notif_title text;
  _notif_body text;
BEGIN
  IF NEW.status NOT IN ('placed', 'enquired') THEN
    RETURN NEW;
  END IF;

  SELECT sp.user_id INTO _seller_user_id
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  SELECT p.name INTO _buyer_name
  FROM profiles p WHERE p.id = NEW.buyer_id;

  IF NEW.status = 'placed' THEN
    _notif_title := '🆕 New Order Received!';
    _notif_body := COALESCE(_buyer_name, 'Customer') || ' placed an order. Tap to view and accept.';
  ELSIF NEW.status = 'enquired' THEN
    _notif_title := '📋 New Booking Request!';
    _notif_body := COALESCE(_buyer_name, 'Customer') || ' sent a booking request. Tap to view.';
  END IF;

  IF _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _seller_user_id,
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
