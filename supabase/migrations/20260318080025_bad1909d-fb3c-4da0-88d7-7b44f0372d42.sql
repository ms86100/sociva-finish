
-- Add silent_push column
ALTER TABLE public.category_status_flows 
  ADD COLUMN IF NOT EXISTS silent_push boolean DEFAULT false;

-- Update trigger to include silent_push in payload
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller_name text;
  v_seller_user_id uuid;
  v_parent_group text;
  v_transaction_type text;
  v_title text;
  v_body text;
  v_action text;
  v_payload jsonb;
  v_seller_title text;
  v_seller_body text;
  v_silent_push boolean;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT sp.business_name, sp.user_id, COALESCE(sp.primary_group, 'default')
  INTO v_seller_name, v_seller_user_id, v_parent_group
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  v_seller_name := COALESCE(v_seller_name, 'The seller');

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
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN
    v_transaction_type := 'self_fulfillment';
  ELSE
    v_transaction_type := 'cart_purchase';
  END IF;

  SELECT csf.notification_title, csf.notification_body, csf.notification_action,
         csf.seller_notification_title, csf.seller_notification_body,
         COALESCE(csf.silent_push, false)
  INTO v_title, v_body, v_action, v_seller_title, v_seller_body, v_silent_push
  FROM public.category_status_flows csf
  WHERE csf.parent_group = v_parent_group
    AND csf.transaction_type = v_transaction_type
    AND csf.status_key = NEW.status
    AND (csf.notify_buyer = true OR csf.notify_seller = true);

  IF v_title IS NULL AND v_seller_title IS NULL THEN
    SELECT csf.notification_title, csf.notification_body, csf.notification_action,
           csf.seller_notification_title, csf.seller_notification_body,
           COALESCE(csf.silent_push, false)
    INTO v_title, v_body, v_action, v_seller_title, v_seller_body, v_silent_push
    FROM public.category_status_flows csf
    WHERE csf.parent_group = 'default'
      AND csf.transaction_type = v_transaction_type
      AND csf.status_key = NEW.status
      AND (csf.notify_buyer = true OR csf.notify_seller = true);
  END IF;

  IF v_title IS NOT NULL THEN
    v_title := replace(v_title, '{seller_name}', v_seller_name);
    v_body := replace(COALESCE(v_body, ''), '{seller_name}', v_seller_name);

    v_payload := jsonb_build_object(
      'orderId', NEW.id::text,
      'status', NEW.status::text,
      'type', 'order_status'
    );
    IF v_action IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('action', v_action);
    END IF;
    IF v_silent_push THEN
      v_payload := v_payload || jsonb_build_object('silent_push', true);
    END IF;

    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      NEW.buyer_id, 'order_status', v_title, v_body,
      '/orders/' || NEW.id::text,
      v_payload
    );
  END IF;

  IF v_seller_title IS NOT NULL AND v_seller_user_id IS NOT NULL THEN
    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      v_seller_user_id, 'order_status', v_seller_title,
      COALESCE(v_seller_body, ''),
      '/seller/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id::text, 'status', NEW.status::text, 'type', 'order_status')
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
