CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _user_id uuid;
  _title text;
  _body text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _user_id := NEW.buyer_id;
    _title := 'Order Placed';
    _body := 'Your order has been placed successfully.';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    _user_id := NEW.buyer_id;
    _title := 'Order Update';
    _body := 'Your order status changed to ' || NEW.status::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_queue (user_id, title, body, type, payload)
  VALUES (
    _user_id, _title, _body, 'order_status',
    jsonb_build_object(
      'order_id', NEW.id,
      'old_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text ELSE NULL END,
      'new_status', NEW.status::text,
      'buyer_id', NEW.buyer_id,
      'seller_id', NEW.seller_id
    )
  );
  RETURN NEW;
END;
$$;