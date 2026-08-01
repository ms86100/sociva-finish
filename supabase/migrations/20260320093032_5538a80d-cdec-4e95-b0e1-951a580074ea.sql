
-- Make push notifications fully DB-driven from category_status_flows
-- Replace hardcoded CASE block with flow-table lookup

CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_name text;
  v_seller_logo_url text;
  v_seller_user_id uuid;
  v_title text;
  v_body text;
  v_silent boolean := false;
  v_already_queued boolean;
  v_ref_path text;
  v_buyer_name text;
  v_is_terminal boolean := false;
  v_parent_group text;
  v_listing_type text;
  v_transaction_type text;
  v_notify_buyer boolean;
  v_notify_seller boolean;
  v_seller_title text;
  v_seller_body text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_ref_path := '/orders/' || NEW.id::text;

  -- Dedup: skip if same notification queued in last 30s
  SELECT EXISTS (
    SELECT 1 FROM public.notification_queue
    WHERE reference_path = v_ref_path
      AND payload->>'status' = NEW.status::text
      AND created_at > now() - interval '30 seconds'
  ) INTO v_already_queued;

  IF v_already_queued THEN
    RAISE NOTICE 'Skipping duplicate notification for order % status %', NEW.id, NEW.status;
    RETURN NEW;
  END IF;

  -- Fetch seller info
  SELECT sp.business_name, sp.profile_image_url, sp.user_id, sp.primary_group
  INTO v_seller_name, v_seller_logo_url, v_seller_user_id, v_parent_group
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  v_parent_group := COALESCE(v_parent_group, 'default');

  -- Resolve listing_type from the order's product
  SELECT cc.transaction_type INTO v_listing_type
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  JOIN public.category_config cc ON cc.category = p.category
  WHERE oi.order_id = NEW.id
  LIMIT 1;

  -- Resolve transaction_type (mirrors client-side resolveTransactionType)
  IF v_listing_type = 'contact_only' THEN
    v_transaction_type := 'contact_enquiry';
  ELSIF NEW.order_type = 'enquiry' AND v_parent_group IN ('classes', 'events') THEN
    v_transaction_type := 'service_booking';
  ELSIF NEW.order_type = 'enquiry' THEN
    v_transaction_type := 'request_service';
  ELSIF NEW.order_type = 'booking' THEN
    v_transaction_type := 'service_booking';
  ELSIF NEW.fulfillment_type = 'self_pickup' THEN
    v_transaction_type := 'self_fulfillment';
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'seller_delivery' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
    v_transaction_type := 'cart_purchase';
  ELSE
    v_transaction_type := 'self_fulfillment';
  END IF;

  -- Look up notification config from category_status_flows
  SELECT
    csf.notification_title,
    csf.notification_body,
    COALESCE(csf.notify_buyer, true),
    COALESCE(csf.silent_push, false),
    COALESCE(csf.notify_seller, false),
    csf.seller_notification_title,
    csf.seller_notification_body,
    COALESCE(csf.is_terminal, false)
  INTO
    v_title,
    v_body,
    v_notify_buyer,
    v_silent,
    v_notify_seller,
    v_seller_title,
    v_seller_body,
    v_is_terminal
  FROM public.category_status_flows csf
  WHERE csf.status_key = NEW.status
    AND csf.parent_group = v_parent_group
    AND csf.transaction_type = v_transaction_type
    AND csf.is_deprecated = false
  LIMIT 1;

  -- Fallback: try default parent_group if no match
  IF v_title IS NULL THEN
    SELECT
      csf.notification_title,
      csf.notification_body,
      COALESCE(csf.notify_buyer, true),
      COALESCE(csf.silent_push, false),
      COALESCE(csf.notify_seller, false),
      csf.seller_notification_title,
      csf.seller_notification_body,
      COALESCE(csf.is_terminal, false)
    INTO
      v_title,
      v_body,
      v_notify_buyer,
      v_silent,
      v_notify_seller,
      v_seller_title,
      v_seller_body,
      v_is_terminal
    FROM public.category_status_flows csf
    WHERE csf.status_key = NEW.status
      AND csf.parent_group = 'default'
      AND csf.transaction_type = v_transaction_type
      AND csf.is_deprecated = false
    LIMIT 1;
  END IF;

  -- No matching flow row → no notification
  IF v_title IS NULL THEN
    -- Still check terminal for cleanup
    IF NEW.status IN ('delivered', 'completed', 'cancelled', 'no_show', 'failed') THEN
      DELETE FROM public.live_activity_tokens WHERE order_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Replace placeholders in title and body
  v_title := replace(v_title, '{seller_name}', COALESCE(v_seller_name, 'the seller'));
  v_body := replace(v_body, '{seller_name}', COALESCE(v_seller_name, 'the seller'));

  -- Enqueue buyer notification
  IF v_notify_buyer THEN
    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      NEW.buyer_id, 'order', v_title, v_body,
      v_ref_path,
      jsonb_build_object(
        'orderId', NEW.id::text,
        'status', NEW.status::text,
        'type', 'order_status',
        'silent_push', COALESCE(v_silent, false),
        'image_url', COALESCE(v_seller_logo_url, ''),
        'seller_logo_url', COALESCE(v_seller_logo_url, '')
      )
    );
  END IF;

  -- Enqueue seller notification if configured
  IF v_notify_seller AND v_seller_user_id IS NOT NULL AND v_seller_title IS NOT NULL THEN
    SELECT p.name INTO v_buyer_name FROM public.profiles p WHERE p.id = NEW.buyer_id;
    v_seller_title := replace(v_seller_title, '{buyer_name}', COALESCE(v_buyer_name, 'A customer'));
    v_seller_body := replace(COALESCE(v_seller_body, ''), '{buyer_name}', COALESCE(v_buyer_name, 'A customer'));

    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      v_seller_user_id, 'order', v_seller_title, v_seller_body,
      v_ref_path,
      jsonb_build_object(
        'orderId', NEW.id::text,
        'status', NEW.status::text,
        'type', 'order_status',
        'silent_push', false,
        'image_url', ''
      )
    );
  END IF;

  -- Hardcoded terminal fallback for safety
  IF NOT v_is_terminal AND NEW.status IN ('delivered', 'completed', 'cancelled', 'no_show', 'failed') THEN
    v_is_terminal := true;
  END IF;

  IF v_is_terminal THEN
    DELETE FROM public.live_activity_tokens WHERE order_id = NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
