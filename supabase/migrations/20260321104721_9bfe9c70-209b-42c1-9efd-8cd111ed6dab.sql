
-- ============================================================
-- Round 30: Four fixes for order trigger chain reliability
-- ============================================================

-- FIX 1: Seed food_beverages/seller_delivery notification fields
-- Copy from default/seller_delivery which has the correct data
UPDATE public.category_status_flows dst
SET
  notification_title = src.notification_title,
  notification_body = src.notification_body,
  notify_buyer = src.notify_buyer,
  notify_seller = src.notify_seller,
  seller_notification_title = src.seller_notification_title,
  seller_notification_body = src.seller_notification_body,
  notification_action = src.notification_action,
  notification_image_url = src.notification_image_url,
  silent_push = src.silent_push
FROM public.category_status_flows src
WHERE src.parent_group = 'default'
  AND src.transaction_type = 'seller_delivery'
  AND dst.parent_group = 'food_beverages'
  AND dst.transaction_type = 'seller_delivery'
  AND dst.status_key = src.status_key
  AND dst.notification_title IS NULL;

-- FIX 2: Add default-fallback logic to fn_enqueue_order_status_notification
-- If the specific parent_group lookup yields NULL title, retry with 'default'
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
BEGIN
  -- Only fire on status changes
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Basic order info
  v_buyer_id     := NEW.buyer_id;
  v_order_number := LEFT(NEW.id::text, 8);

  -- Get seller info
  SELECT sp.id, sp.business_name, sp.user_id
    INTO v_seller_id, v_seller_name, v_seller_user_id
    FROM public.seller_profiles sp
   WHERE sp.id = NEW.seller_id;

  -- Get buyer name
  SELECT COALESCE(p.name, 'Customer')
    INTO v_buyer_name
    FROM public.profiles p
   WHERE p.id = v_buyer_id;

  -- resolve transaction_type via first order-item's product
  SELECT oi.product_id INTO v_product_id
    FROM public.order_items oi
   WHERE oi.order_id = NEW.id
   LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    SELECT cc.transaction_type, cc.parent_group
      INTO v_listing_type, v_parent_group
      FROM public.products pr
      JOIN public.category_config cc ON cc.category = pr.category::service_category
     WHERE pr.id = v_product_id;
  END IF;

  -- Resolve transaction_type using fulfillment_type/delivery_handled_by
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

  -- Special handling for cart-based (multi-item) orders
  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = NEW.id OFFSET 1
  ) AND v_listing_type = 'purchase' THEN
    v_transaction_type := CASE
      WHEN NEW.fulfillment_type IN ('delivery', 'seller_delivery') THEN 'cart_purchase'
      ELSE 'self_fulfillment'
    END;
  END IF;

  -- === PRIMARY LOOKUP: specific parent_group ===
  v_lookup_group := COALESCE(v_parent_group, 'default');

  SELECT csf.notification_title,
         csf.notification_body,
         csf.seller_notification_title,
         csf.seller_notification_body,
         csf.notify_buyer,
         csf.notify_seller,
         csf.silent_push,
         csf.is_terminal
    INTO v_title, v_body, v_seller_title, v_seller_body,
         v_notify_buyer, v_notify_seller, v_silent, v_is_terminal
    FROM public.category_status_flows csf
   WHERE csf.status_key = NEW.status::text
     AND csf.transaction_type = v_transaction_type
     AND csf.parent_group = v_lookup_group
   LIMIT 1;

  -- === FALLBACK: if title is NULL and we didn't already use 'default', retry with 'default' ===
  IF v_title IS NULL AND v_lookup_group <> 'default' THEN
    SELECT csf.notification_title,
           csf.notification_body,
           csf.seller_notification_title,
           csf.seller_notification_body,
           csf.notify_buyer,
           csf.notify_seller,
           csf.silent_push,
           csf.is_terminal
      INTO v_title, v_body, v_seller_title, v_seller_body,
           v_notify_buyer, v_notify_seller, v_silent, v_is_terminal
      FROM public.category_status_flows csf
     WHERE csf.status_key = NEW.status::text
       AND csf.transaction_type = v_transaction_type
       AND csf.parent_group = 'default'
     LIMIT 1;
  END IF;

  -- Replace placeholders
  v_body        := REPLACE(COALESCE(v_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_body        := REPLACE(v_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_body        := REPLACE(v_body, '{order_number}', v_order_number);
  v_seller_body := REPLACE(COALESCE(v_seller_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_seller_body := REPLACE(v_seller_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_seller_body := REPLACE(v_seller_body, '{order_number}', v_order_number);

  -- Buyer notification
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
          'action', COALESCE(
            (SELECT csf2.notification_action FROM public.category_status_flows csf2
              WHERE csf2.status_key = NEW.status::text
                AND csf2.transaction_type = v_transaction_type
                AND csf2.parent_group = COALESCE(v_parent_group, 'default')
              LIMIT 1),
            'View Order'
          ),
          'type', 'order',
          'is_terminal', v_is_terminal,
          'silent_push', v_silent,
          'seller_name', COALESCE(v_seller_name, 'Seller')
        )
      );
    END IF;
  END IF;

  -- Seller notification
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
END;
$function$;

-- FIX 3: Drop duplicate updated_at trigger on orders
DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;

-- FIX 4: Scope auto_dismiss_delivery_notifications to the specific order's buyer
CREATE OR REPLACE FUNCTION public.auto_dismiss_delivery_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only act on terminal statuses
  IF NEW.status IN ('delivered', 'completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.user_notifications
    SET is_read = true
    WHERE is_read = false
      AND user_id = NEW.buyer_id
      AND type IN ('delivery_location_update', 'delivery_at_gate')
      AND payload->>'orderId' = NEW.id::text;
  END IF;
  RETURN NEW;
END;
$function$;
