-- Bug 1: Fix auto_dismiss_delivery_notifications to use correct notification type names
CREATE OR REPLACE FUNCTION public.auto_dismiss_delivery_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('delivered', 'completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.user_notifications
    SET is_read = true
    WHERE is_read = false
      AND user_id = NEW.buyer_id
      AND type IN ('delivery_en_route', 'delivery_proximity', 'delivery_proximity_imminent', 'delivery_stalled', 'delivery_delayed')
      AND (
        payload->>'orderId' = NEW.id::text
        OR payload->>'order_id' = NEW.id::text
        OR payload->>'entity_id' = NEW.id::text
      );
  END IF;
  RETURN NEW;
END;
$function$;

-- Bug 2: Fix notification_action lookup to use the same fallback group as title/body
-- The action sub-query at line 191-198 uses v_parent_group directly instead of the resolved fallback group
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
      JOIN public.category_config cc ON cc.category = pr.category::service_category
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

  -- === PRIMARY LOOKUP: specific parent_group ===
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

  -- Track which group resolved the title
  v_resolved_group := v_lookup_group;

  -- === FALLBACK: if title is NULL and we didn't already use 'default', retry with 'default' ===
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

  -- If notification_action is still NULL after lookup, also check the fallback group
  IF v_notification_action IS NULL AND v_resolved_group <> 'default' THEN
    SELECT csf.notification_action INTO v_notification_action
      FROM public.category_status_flows csf
     WHERE csf.status_key = NEW.status::text
       AND csf.transaction_type = v_transaction_type
       AND csf.parent_group = 'default'
     LIMIT 1;
  END IF;

  v_notification_action := COALESCE(v_notification_action, 'View Order');

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
          'action', v_notification_action,
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
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;