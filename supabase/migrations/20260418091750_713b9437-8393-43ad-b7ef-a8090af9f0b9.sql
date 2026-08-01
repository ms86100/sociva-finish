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
BEGIN
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;

  _is_auto_accepted := (NEW.status = 'preparing');

  SELECT user_id INTO _seller_user_id FROM seller_profiles WHERE id = NEW.seller_id;
  SELECT name INTO _buyer_name FROM profiles WHERE id = NEW.buyer_id;

  IF _seller_user_id IS NOT NULL THEN
    IF _is_auto_accepted THEN
      _seller_title := '✅ Order Auto-Accepted';
      _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || COALESCE(NEW.total_amount, 0) || '. Auto-accepted — start preparing!';
    ELSE
      _seller_title := '🔔 New Order Received';
      _seller_body := COALESCE(_buyer_name, 'Customer') || ' placed an order worth Rs ' || COALESCE(NEW.total_amount, 0) || '. Tap to accept!';
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
        'total', NEW.total_amount,
        'type', NEW.order_type,
        'auto_accepted', _is_auto_accepted,
        'target_role', 'seller',
        'status', NEW.status,
        'action', 'view_order',
        'reference_path', '/orders/' || NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;