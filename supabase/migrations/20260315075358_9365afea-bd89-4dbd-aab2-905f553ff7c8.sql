
-- Add seller notification columns
ALTER TABLE public.category_status_flows
  ADD COLUMN IF NOT EXISTS notify_seller boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS seller_notification_title text,
  ADD COLUMN IF NOT EXISTS seller_notification_body text;

-- Replace trigger function: fix type mismatch + add seller notifications
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
  v_seller_title text;
  v_seller_body text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Get seller name and parent_group
  SELECT sp.business_name, COALESCE(sp.primary_group, 'default')
  INTO v_seller_name, v_parent_group
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  v_seller_name := COALESCE(v_seller_name, 'The seller');

  -- Resolve transaction_type
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

  -- Look up buyer + seller notification config
  SELECT csf.notification_title, csf.notification_body, csf.notification_action,
         csf.seller_notification_title, csf.seller_notification_body
  INTO v_title, v_body, v_action, v_seller_title, v_seller_body
  FROM public.category_status_flows csf
  WHERE csf.parent_group = v_parent_group
    AND csf.transaction_type = v_transaction_type
    AND csf.status_key = NEW.status
    AND (csf.notify_buyer = true OR csf.notify_seller = true);

  -- Fallback to 'default' parent_group
  IF v_title IS NULL AND v_seller_title IS NULL THEN
    SELECT csf.notification_title, csf.notification_body, csf.notification_action,
           csf.seller_notification_title, csf.seller_notification_body
    INTO v_title, v_body, v_action, v_seller_title, v_seller_body
    FROM public.category_status_flows csf
    WHERE csf.parent_group = 'default'
      AND csf.transaction_type = v_transaction_type
      AND csf.status_key = NEW.status
      AND (csf.notify_buyer = true OR csf.notify_seller = true);
  END IF;

  -- Buyer notification
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

    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      NEW.buyer_id, 'order_status', v_title, v_body,
      '/orders/' || NEW.id::text,
      v_payload
    );
  END IF;

  -- Seller notification
  IF v_seller_title IS NOT NULL THEN
    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      NEW.seller_id, 'order_status', v_seller_title,
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
$fn$;
