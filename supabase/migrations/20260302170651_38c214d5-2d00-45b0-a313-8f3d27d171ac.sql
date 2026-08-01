
CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seller_user_id uuid;
  v_buyer_name text;
  v_exists boolean;
BEGIN
  IF NEW.status NOT IN ('placed', 'enquired') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.notification_queue
    WHERE (payload->>'orderId')::text = NEW.id::text
      AND (payload->>'status')::text = NEW.status::text
  ) INTO v_exists;

  IF v_exists THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_seller_user_id
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF v_seller_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, 'A buyer') INTO v_buyer_name
  FROM public.profiles
  WHERE id = NEW.buyer_id;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    v_seller_user_id,
    CASE WHEN NEW.status = 'placed' THEN 'New Order Received! 🛒'
         ELSE 'New Enquiry Received! 💬'
    END,
    v_buyer_name || CASE WHEN NEW.status = 'placed' THEN ' placed a new order'
                         ELSE ' sent an enquiry'
                    END,
    CASE WHEN NEW.status = 'placed' THEN 'order_placed'
         ELSE 'enquiry_received'
    END,
    '/orders/' || NEW.id,
    jsonb_build_object('orderId', NEW.id, 'status', NEW.status::text, 'buyerId', NEW.buyer_id)
  );

  RETURN NEW;
END;
$$;
