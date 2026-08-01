
-- 1. Add buyer_received to order_status enum
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'buyer_received' AFTER 'ready';

-- 2. Add buyer_confirmed_at column
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS buyer_confirmed_at timestamptz;

-- 3. Fix fn_enqueue_order_status_notification: unsafe service_category cast
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer_id       uuid;
  v_seller_id      uuid;
  v_seller_name    text;
  v_buyer_name     text;
  v_order_number   text;
  v_title          text;
  v_body           text;
  v_seller_title   text;
  v_seller_body    text;
  v_silent         boolean := false;
  v_is_terminal    boolean := false;
  v_notify_buyer   boolean := true;
  v_notify_seller  boolean := false;
  v_listing_type   text;
  v_transaction_type text;
  v_parent_group   text;
  v_existing_id    uuid;
  v_product_id     uuid;
  v_seller_user_id uuid;
  v_lookup_group   text;
  v_resolved_group text;
  v_notification_action text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_buyer_id     := NEW.buyer_id;
  v_order_number := LEFT(NEW.id::text, 8);

  SELECT sp.id, sp.business_name, sp.user_id
    INTO v_seller_id, v_seller_name, v_seller_user_id
    FROM public.seller_profiles sp
   WHERE sp.id = NEW.seller_id;

  SELECT COALESCE(p.name, 'Customer')
    INTO v_buyer_name
    FROM public.profiles p
   WHERE p.id = v_buyer_id;

  SELECT oi.product_id INTO v_product_id
    FROM public.order_items oi
   WHERE oi.order_id = NEW.id
   LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    SELECT cc.transaction_type, cc.parent_group
      INTO v_listing_type, v_parent_group
      FROM public.products pr
      JOIN public.category_config cc ON cc.category::text = pr.category
     WHERE pr.id = v_product_id;
  END IF;

  IF NEW.order_type = 'enquiry' THEN
    IF COALESCE(v_parent_group, 'default') IN ('classes', 'events') THEN
      v_transaction_type := 'service_booking';
    ELSE
      v_transaction_type := 'request_service';
    END IF;
  ELSIF NEW.order_type = 'booking' THEN
    v_transaction_type := 'service_booking';
  ELSIF NEW.fulfillment_type = 'self_pickup' THEN
    v_transaction_type := 'self_fulfillment';
  ELSIF NEW.fulfillment_type = 'seller_delivery' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
    v_transaction_type := 'cart_purchase';
  ELSE
    v_transaction_type := 'self_fulfillment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = NEW.id OFFSET 1
  ) AND v_listing_type = 'purchase' THEN
    v_transaction_type := CASE
      WHEN NEW.fulfillment_type IN ('delivery', 'seller_delivery') THEN 'cart_purchase'
      ELSE 'self_fulfillment'
    END;
  END IF;

  v_lookup_group := COALESCE(v_parent_group, 'default');

  SELECT csf.notification_title,
         csf.notification_body,
         csf.seller_notification_title,
         csf.seller_notification_body,
         csf.notify_buyer,
         csf.notify_seller,
         csf.silent_push,
         csf.is_terminal,
         csf.notification_action
    INTO v_title, v_body, v_seller_title, v_seller_body,
         v_notify_buyer, v_notify_seller, v_silent, v_is_terminal,
         v_notification_action
    FROM public.category_status_flows csf
   WHERE csf.status_key = NEW.status::text
     AND csf.transaction_type = v_transaction_type
     AND csf.parent_group = v_lookup_group
   LIMIT 1;

  v_resolved_group := v_lookup_group;

  IF v_title IS NULL AND v_lookup_group <> 'default' THEN
    SELECT csf.notification_title,
           csf.notification_body,
           csf.seller_notification_title,
           csf.seller_notification_body,
           csf.notify_buyer,
           csf.notify_seller,
           csf.silent_push,
           csf.is_terminal,
           csf.notification_action
      INTO v_title, v_body, v_seller_title, v_seller_body,
           v_notify_buyer, v_notify_seller, v_silent, v_is_terminal,
           v_notification_action
      FROM public.category_status_flows csf
     WHERE csf.status_key = NEW.status::text
       AND csf.transaction_type = v_transaction_type
       AND csf.parent_group = 'default'
     LIMIT 1;

    v_resolved_group := 'default';
  END IF;

  IF v_notification_action IS NULL AND v_resolved_group <> 'default' THEN
    SELECT csf.notification_action INTO v_notification_action
      FROM public.category_status_flows csf
     WHERE csf.status_key = NEW.status::text
       AND csf.transaction_type = v_transaction_type
       AND csf.parent_group = 'default'
     LIMIT 1;
  END IF;

  v_notification_action := COALESCE(v_notification_action, 'View Order');

  v_body        := REPLACE(COALESCE(v_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_body        := REPLACE(v_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_body        := REPLACE(v_body, '{order_number}', v_order_number);
  v_seller_body := REPLACE(COALESCE(v_seller_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_seller_body := REPLACE(v_seller_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_seller_body := REPLACE(v_seller_body, '{order_number}', v_order_number);

  IF v_notify_buyer AND v_title IS NOT NULL AND v_title <> '' THEN
    SELECT id INTO v_existing_id
      FROM public.notification_queue
     WHERE user_id = v_buyer_id
       AND title = v_title
       AND payload->>'orderId' = NEW.id::text
       AND created_at > NOW() - INTERVAL '30 seconds'
     LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.notification_queue (
        user_id, title, body, type, reference_path, payload
      ) VALUES (
        v_buyer_id,
        v_title,
        v_body,
        'order_status',
        '/orders/' || NEW.id,
        jsonb_build_object(
          'orderId', NEW.id,
          'status', NEW.status::text,
          'action', v_notification_action,
          'type', 'order',
          'is_terminal', v_is_terminal,
          'silent_push', v_silent,
          'seller_name', COALESCE(v_seller_name, 'Seller')
        )
      );
    END IF;
  END IF;

  IF v_notify_seller AND v_seller_user_id IS NOT NULL THEN
    v_seller_title := COALESCE(v_seller_title, v_title, 'Order Update');
    IF v_seller_title IS NOT NULL AND v_seller_title <> '' THEN
      SELECT id INTO v_existing_id
        FROM public.notification_queue
       WHERE user_id = v_seller_user_id
         AND title = v_seller_title
         AND payload->>'orderId' = NEW.id::text
         AND created_at > NOW() - INTERVAL '30 seconds'
       LIMIT 1;

      IF v_existing_id IS NULL THEN
        INSERT INTO public.notification_queue (
          user_id, title, body, type, reference_path, payload
        ) VALUES (
          v_seller_user_id,
          v_seller_title,
          COALESCE(NULLIF(v_seller_body, ''), v_body, ''),
          'order_status',
          '/orders/' || NEW.id,
          jsonb_build_object(
            'orderId', NEW.id,
            'status', NEW.status::text,
            'action', 'View Order',
            'type', 'order',
            'is_terminal', v_is_terminal,
            'buyer_name', COALESCE(v_buyer_name, 'Customer')
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- 4. Create confirm_cod_payment RPC for sellers
CREATE OR REPLACE FUNCTION public.confirm_cod_payment(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_seller_user_id uuid;
BEGIN
  SELECT o.id, o.seller_id, o.payment_type, o.payment_status
  INTO v_order
  FROM orders o
  WHERE o.id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT sp.user_id INTO v_seller_user_id
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the seller can confirm COD payment';
  END IF;

  IF v_order.payment_type <> 'cod' THEN
    RAISE EXCEPTION 'This order is not a COD order';
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN; -- Already paid, idempotent
  END IF;

  UPDATE orders
  SET payment_status = 'paid',
      payment_confirmed_at = now(),
      updated_at = now()
  WHERE id = _order_id;
END;
$function$;

-- 5. Update buyer_advance_order to auto-set COD payment_status on completion
CREATE OR REPLACE FUNCTION public.buyer_advance_order(_order_id uuid, _new_status order_status)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_valid BOOLEAN;
  v_listing_type TEXT;
BEGIN
  SELECT o.id, o.status, o.buyer_id, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         o.payment_type, o.payment_status,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized — you are not the buyer of this order';
  END IF;

  v_parent_group := COALESCE(v_order.primary_group, 'default');

  SELECT cc.transaction_type INTO v_listing_type
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN category_config cc ON cc.category::text = p.category
  WHERE oi.order_id = _order_id
  LIMIT 1;

  IF v_listing_type = 'contact_only' THEN
    v_transaction_type := 'contact_enquiry';
  ELSIF v_order.order_type = 'enquiry' THEN
    IF v_parent_group IN ('classes', 'events') THEN
      v_transaction_type := 'service_booking';
    ELSE
      v_transaction_type := 'request_service';
    END IF;
  ELSIF v_order.order_type = 'booking' THEN
    v_transaction_type := 'service_booking';
  ELSIF v_order.fulfillment_type = 'self_pickup' THEN
    v_transaction_type := 'self_fulfillment';
  ELSIF v_order.fulfillment_type = 'seller_delivery' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF v_order.fulfillment_type = 'delivery' AND (v_order.delivery_handled_by IS NULL OR v_order.delivery_handled_by = 'seller') THEN
    v_transaction_type := 'seller_delivery';
  ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
    v_transaction_type := 'cart_purchase';
  ELSE
    v_transaction_type := 'self_fulfillment';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text
      AND to_status = _new_status::text
      AND allowed_actor = 'buyer'
      AND (
        (parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type)
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid buyer transition from % to %', v_order.status, _new_status;
  END IF;

  -- For COD orders transitioning to completed, auto-mark payment as paid
  IF _new_status::text = 'completed' AND v_order.payment_type = 'cod' AND COALESCE(v_order.payment_status, 'pending') <> 'paid' THEN
    UPDATE orders
    SET status = _new_status,
        payment_status = 'paid',
        payment_confirmed_at = now(),
        buyer_confirmed_at = now(),
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  ELSE
    UPDATE orders
    SET status = _new_status,
        buyer_confirmed_at = CASE WHEN _new_status::text = 'completed' THEN now() ELSE buyer_confirmed_at END,
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  END IF;
END;
$function$;
