
-- Bug 2: Fix trigger fallback from 'food_and_beverage' (typo) to 'default'
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- Only fire on status changes
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Basic order info
  v_buyer_id     := NEW.buyer_id;
  v_order_number := COALESCE(NEW.order_number, LEFT(NEW.id::text, 8));

  -- Get seller info
  SELECT sp.id, sp.business_name, sp.user_id
    INTO v_seller_id, v_seller_name, v_seller_user_id
    FROM public.seller_profiles sp
   WHERE sp.id = NEW.seller_id;

  -- Get buyer name
  SELECT COALESCE(p.full_name, p.username, 'Customer')
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
      FROM public.products p
      JOIN public.category_config cc ON cc.category = p.category::service_category
     WHERE p.id = v_product_id;
  END IF;

  -- Map listing type to transaction_type used in category_status_flows
  v_transaction_type := CASE
    WHEN NEW.requires_delivery = true AND v_listing_type = 'purchase'     THEN 'seller_delivery'
    WHEN NEW.requires_delivery = false AND v_listing_type = 'purchase'    THEN 'self_fulfillment'
    WHEN v_listing_type = 'booking'                                       THEN 'service_booking'
    WHEN v_listing_type = 'rental'                                        THEN 'rental'
    WHEN v_listing_type = 'enquiry'                                       THEN 'enquiry'
    WHEN NEW.requires_delivery = true                                     THEN 'seller_delivery'
    ELSE 'self_fulfillment'
  END;

  -- Special handling for cart-based (multi-item) orders
  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = NEW.id OFFSET 1
  ) AND v_listing_type = 'purchase' THEN
    v_transaction_type := CASE
      WHEN NEW.requires_delivery THEN 'cart_purchase'
      ELSE 'self_fulfillment'
    END;
  END IF;

  -- Look up notification config from category_status_flows
  -- Bug 2 fix: fallback to 'default' instead of typo 'food_and_beverage'
  SELECT
    csf.notification_title,
    csf.notification_body,
    csf.seller_notification_title,
    csf.seller_notification_body,
    COALESCE(csf.notify_buyer, true),
    COALESCE(csf.notify_seller, false),
    COALESCE(csf.silent_push, false),
    COALESCE(csf.is_terminal, false)
  INTO
    v_title,
    v_body,
    v_seller_title,
    v_seller_body,
    v_notify_buyer,
    v_notify_seller,
    v_silent,
    v_is_terminal
  FROM public.category_status_flows csf
  WHERE csf.status_key = NEW.status::text
    AND csf.transaction_type = v_transaction_type
    AND csf.parent_group = COALESCE(v_parent_group, 'default')
  LIMIT 1;

  -- Replace placeholders
  v_body        := REPLACE(COALESCE(v_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_body        := REPLACE(v_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_body        := REPLACE(v_body, '{order_number}', v_order_number);
  v_seller_body := REPLACE(COALESCE(v_seller_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_seller_body := REPLACE(v_seller_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_seller_body := REPLACE(v_seller_body, '{order_number}', v_order_number);

  -- Buyer notification
  IF v_notify_buyer AND v_title IS NOT NULL AND v_title <> '' THEN
    -- Dedup: skip if same notification already queued in last 30s
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
$$;
