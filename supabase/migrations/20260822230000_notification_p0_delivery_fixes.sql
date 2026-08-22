-- P0: Fix seller new-order enqueue (partial unique index ON CONFLICT),
-- empty workflow notification copy, and heal blank in-app rows.

CREATE OR REPLACE FUNCTION public.notification_copy_or_fallback(p_text text, p_fallback text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(btrim(p_text), ''), p_fallback);
$$;

CREATE OR REPLACE FUNCTION public.enqueue_seller_new_order_notification(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_seller_user_id uuid;
  v_seller_business_name text;
  v_buyer_name text;
  v_buyer_flat_no text;
  v_order_items jsonb;
  v_item_line text;
  v_location text;
  v_amount numeric;
  v_title text;
  v_body text;
  v_idem_key text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_order.status IN ('payment_pending', 'cancelled') THEN RETURN; END IF;

  SELECT sp.user_id, sp.business_name INTO v_seller_user_id, v_seller_business_name
  FROM public.seller_profiles sp WHERE sp.id = v_order.seller_id;
  IF v_seller_user_id IS NULL THEN RETURN; END IF;

  SELECT p.name, p.flat_number INTO v_buyer_name, v_buyer_flat_no
  FROM public.profiles p WHERE p.id = v_order.buyer_id;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', p.name,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'total_price', oi.quantity * oi.unit_price
  )) INTO v_order_items
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = v_order.id;

  IF v_order_items IS NULL THEN v_order_items := '[]'::jsonb; END IF;

  v_item_line := public.seller_order_item_summary(v_order.id);
  v_location := public.seller_order_buyer_location_summary(
    v_order.seller_id, v_order.buyer_id, v_order.delivery_address,
    v_order.delivery_lat, v_order.delivery_lng, v_order.society_id
  );
  v_amount := v_order.total_amount;
  v_idem_key := md5(v_order.id::text || '-new_order-' || v_order.status::text);

  v_title := CASE
    WHEN v_item_line IS NOT NULL THEN left('New order: ' || v_item_line, 65)
    ELSE 'New order received'
  END;

  v_body := COALESCE(v_item_line, 'New order');
  IF COALESCE(v_amount, 0) > 0 THEN
    v_body := v_body || ' · Rs ' || trim(to_char(v_amount, 'FM9999990'));
  END IF;
  v_body := v_body || ' · ' || COALESCE(v_buyer_name, 'Customer');
  IF v_location IS NOT NULL THEN v_body := v_body || ' · ' || v_location; END IF;
  v_body := v_body || '. Tap to review and accept.';

  INSERT INTO public.notification_queue (
    user_id, type, title, body, reference_path, payload, idempotency_key
  )
  VALUES (
    v_seller_user_id,
    'order',
    v_title,
    left(v_body, 240),
    '/orders/' || v_order.id::text,
    jsonb_build_object(
      'orderId', v_order.id::text,
      'order_id', v_order.id::text,
      'status', v_order.status::text,
      'type', 'order',
      'target_role', 'seller',
      'wa_template', 'sociva_new_order_seller',
      'buyer_name', COALESCE(v_buyer_name, 'Customer'),
      'seller_business_name', COALESCE(v_seller_business_name, 'Store'),
      'seller_flat_number', COALESCE(v_buyer_flat_no, ''),
      'buyer_location', v_location,
      'item_summary', v_item_line,
      'items', v_order_items,
      'item_count', COALESCE(jsonb_array_length(v_order_items), 0)
    ),
    v_idem_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title,
        body = EXCLUDED.body,
        payload = EXCLUDED.payload,
        status = CASE
          WHEN notification_queue.status IN ('processed', 'failed') THEN 'pending'
          ELSE notification_queue.status
        END,
        push_skip_reason = NULL,
        processed_at = NULL,
        updated_at = now();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_seller_new_order_notification failed for order %: %', p_order_id, SQLERRM;
END;
$$;

-- Patch order-status notification: treat empty-string workflow copy as missing.
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _txn_type TEXT;
  _parent_group TEXT;
  _flow RECORD;
  _buyer_title TEXT;
  _buyer_body TEXT;
  _seller_title TEXT;
  _seller_body TEXT;
  _seller_user_id UUID;
  _buyer_name TEXT;
  _seller_name TEXT;
  _order_number TEXT;
  _acting_as TEXT;
  _dedupe_exists BOOLEAN;
  _is_auto_accepted BOOLEAN;
  _wa_template TEXT;
  _buyer_payload JSONB;
  _seller_payload JSONB;
  _fallback_buyer BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM notification_queue
    WHERE (payload->>'order_id' = NEW.id::text OR payload->>'orderId' = NEW.id::text)
      AND (payload->>'new_status' = NEW.status::text OR payload->>'status' = NEW.status::text)
      AND created_at > now() - interval '30 seconds'
  ) INTO _dedupe_exists;
  IF _dedupe_exists THEN RETURN NEW; END IF;

  _is_auto_accepted := (TG_OP = 'INSERT' AND NEW.status = 'preparing');

  SELECT sp.user_id, sp.business_name, resolve_transition_parent_group(sp.primary_group)
  INTO _seller_user_id, _seller_name, _parent_group
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;
  _parent_group := COALESCE(_parent_group, 'default');
  _txn_type := COALESCE(NEW.transaction_type, 'self_fulfillment');

  SELECT name INTO _buyer_name FROM profiles WHERE id = NEW.buyer_id;
  _order_number := upper(right(NEW.id::text, 6));
  _acting_as := current_setting('app.acting_as', true);

  SELECT * INTO _flow FROM category_status_flows
  WHERE transaction_type = _txn_type AND parent_group = _parent_group AND status_key = NEW.status::text LIMIT 1;

  IF _flow.id IS NULL THEN
    SELECT * INTO _flow FROM category_status_flows
    WHERE transaction_type = _txn_type AND parent_group = 'default' AND status_key = NEW.status::text LIMIT 1;
  END IF;

  _wa_template := CASE
    WHEN NEW.status::text IN ('accepted', 'auto_accepted', 'confirmed', 'scheduled', 'preparing') THEN 'sociva_booking_confirmed'
    WHEN NEW.status::text IN ('cancelled', 'no_show') THEN 'sociva_booking_cancelled'
    WHEN NEW.status::text LIKE 'refund%' THEN 'sociva_refund_update'
    ELSE 'sociva_order_update'
  END;

  IF TG_OP = 'UPDATE'
     AND NEW.status::text = ANY (ARRAY[
       'assigned', 'on_the_way', 'arrived', 'in_progress', 'at_gate',
       'picked_up', 'ready', 'delivered', 'completed', 'rescheduled', 'provider_changed'
     ])
     AND (_flow.id IS NULL OR NOT COALESCE(_flow.notify_buyer, false))
  THEN
    _fallback_buyer := true;
    _buyer_title := CASE NEW.status::text
      WHEN 'assigned' THEN E'\U0001F464 Provider Assigned'
      WHEN 'provider_changed' THEN E'\U0001F504 Provider Updated'
      WHEN 'on_the_way' THEN E'\U0001F6F5 On The Way'
      WHEN 'arrived' THEN E'\U0001F3E0 Provider Arrived'
      WHEN 'in_progress' THEN E'\U0001F527 Service Started'
      WHEN 'at_gate' THEN E'\U0001F3E0 At Your Gate'
      WHEN 'picked_up' THEN E'\U0001F4E6 Order Picked Up'
      WHEN 'ready' THEN E'\U0001F389 Order Ready'
      WHEN 'delivered' THEN E'\U0001F69A Delivered'
      WHEN 'completed' THEN E'\u2B50 Completed'
      WHEN 'rescheduled' THEN E'\U0001F4C5 Rescheduled'
      ELSE 'Order Update'
    END;
    _buyer_body := CASE NEW.status::text
      WHEN 'assigned' THEN 'A provider has been assigned to your order from ' || COALESCE(_seller_name, 'the seller') || '.'
      WHEN 'provider_changed' THEN 'Your provider for order #' || _order_number || ' was updated.'
      WHEN 'on_the_way' THEN COALESCE(_seller_name, 'Your provider') || ' is on the way.'
      WHEN 'arrived' THEN COALESCE(_seller_name, 'Your provider') || ' has arrived.'
      WHEN 'in_progress' THEN COALESCE(_seller_name, 'Your provider') || ' has started the service.'
      WHEN 'at_gate' THEN COALESCE(_seller_name, 'Your delivery partner') || ' is at the gate.'
      WHEN 'completed' THEN 'Your order from ' || COALESCE(_seller_name, 'the seller') || ' is complete.'
      ELSE 'Your order #' || _order_number || ' is now ' || replace(NEW.status::text, '_', ' ') || '.'
    END;
  END IF;

  IF _is_auto_accepted THEN
    _buyer_payload := jsonb_build_object(
      'order_id', NEW.id, 'orderId', NEW.id,
      'new_status', NEW.status::text, 'status', 'accepted',
      'target_role', 'buyer', 'auto_accepted', true,
      'sellerName', _seller_name, 'providerName', _seller_name,
      'wa_template', 'sociva_booking_confirmed'
    );
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (NEW.buyer_id, E'\u2705 Order Confirmed!',
      'Your order has been accepted and is being prepared by ' || COALESCE(_seller_name, 'the seller') || '.',
      'order_status', '/orders/' || NEW.id::text, _buyer_payload);
  ELSIF (_flow.id IS NOT NULL AND _flow.notify_buyer) OR _fallback_buyer THEN
    IF NOT _fallback_buyer THEN
      _buyer_title := public.notification_copy_or_fallback(_flow.notification_title, 'Order Update');
      _buyer_body := public.notification_copy_or_fallback(_flow.notification_body, 'Your order status changed to ' || NEW.status::text);
      _buyer_title := replace(replace(replace(_buyer_title,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);
      _buyer_body := replace(replace(replace(_buyer_body,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);
    END IF;
    IF NEW.status::text = 'cancelled' AND _acting_as = 'seller' THEN
      _buyer_title := E'\u274C Order Cancelled by Seller';
      _buyer_body := COALESCE(NEW.rejection_reason, 'Your order was cancelled by the seller.');
    END IF;
    _buyer_payload := jsonb_build_object(
      'order_id', NEW.id, 'orderId', NEW.id,
      'new_status', NEW.status::text, 'status', NEW.status::text,
      'old_status', CASE WHEN TG_OP='UPDATE' THEN OLD.status::text ELSE NULL END,
      'target_role', 'buyer', 'sellerName', _seller_name, 'providerName', _seller_name,
      'wa_template', _wa_template
    );
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (NEW.buyer_id, _buyer_title, _buyer_body, 'order_status', '/orders/' || NEW.id::text, _buyer_payload);
  ELSIF _flow.id IS NULL AND TG_OP = 'INSERT' AND NOT _is_auto_accepted THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (NEW.buyer_id, E'\U0001F6D2 Order Placed', 'Your order has been placed successfully.', 'order_status',
      '/orders/' || NEW.id::text,
      jsonb_build_object('order_id', NEW.id, 'orderId', NEW.id, 'new_status', NEW.status::text, 'status', NEW.status::text, 'target_role', 'buyer', 'wa_template', 'sociva_order_update'));
  END IF;

  IF _seller_user_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND NOT _is_auto_accepted THEN
      INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (_seller_user_id, E'\U0001F195 New Order Received!',
        'You have a new order from ' || COALESCE(_buyer_name,'a customer') || ' (#' || _order_number || ')',
        'order_status', '/orders/' || NEW.id::text,
        jsonb_build_object('order_id', NEW.id, 'orderId', NEW.id, 'new_status', NEW.status::text, 'status', NEW.status::text, 'target_role', 'seller', 'wa_template', 'sociva_new_order_seller'));
    ELSIF TG_OP = 'INSERT' AND _is_auto_accepted THEN
      NULL;
    ELSIF _flow.id IS NOT NULL AND _flow.notify_seller THEN
      _seller_title := public.notification_copy_or_fallback(_flow.seller_notification_title, 'Order Update');
      _seller_body := public.notification_copy_or_fallback(_flow.seller_notification_body, 'Order status changed to ' || NEW.status::text);
      _seller_title := replace(replace(replace(_seller_title,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);
      _seller_body := replace(replace(replace(_seller_body,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);
      IF NEW.status::text = 'cancelled' AND _acting_as = 'buyer' THEN
        _seller_title := E'\u274C Order Cancelled by Buyer';
        _seller_body := COALESCE(_buyer_name,'The buyer') || ' cancelled order #' || _order_number;
      END IF;
      INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (_seller_user_id, _seller_title, _seller_body, 'order_status', '/orders/' || NEW.id::text,
        jsonb_build_object('order_id', NEW.id, 'orderId', NEW.id, 'new_status', NEW.status::text, 'status', NEW.status::text, 'target_role', 'seller', 'wa_template', _wa_template));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill empty workflow templates from self_fulfillment/default where available.
UPDATE public.category_status_flows dst
SET
  notification_title = public.notification_copy_or_fallback(dst.notification_title, src.notification_title),
  notification_body = public.notification_copy_or_fallback(dst.notification_body, src.notification_body),
  seller_notification_title = public.notification_copy_or_fallback(dst.seller_notification_title, src.seller_notification_title),
  seller_notification_body = public.notification_copy_or_fallback(dst.seller_notification_body, src.seller_notification_body)
FROM public.category_status_flows src
WHERE dst.parent_group = 'default'
  AND dst.transaction_type IN ('seller_delivery', 'delivery', 'self_pickup')
  AND src.parent_group = 'default'
  AND src.transaction_type = 'self_fulfillment'
  AND src.status_key = dst.status_key
  AND (
    btrim(coalesce(dst.notification_title, '')) = ''
    OR btrim(coalesce(dst.notification_body, '')) = ''
    OR btrim(coalesce(dst.seller_notification_title, '')) = ''
    OR btrim(coalesce(dst.seller_notification_body, '')) = ''
  );

-- Hardcoded buyer fallbacks for common marketplace statuses still empty after copy.
UPDATE public.category_status_flows
SET
  notification_title = CASE status_key
    WHEN 'accepted' THEN E'✅ Order Accepted!'
    WHEN 'preparing' THEN E'👨‍🍳 Order Being Prepared'
    WHEN 'ready' THEN E'🎉 Order Ready!'
    WHEN 'on_the_way' THEN E'🛵 Order On The Way!'
    WHEN 'delivered' THEN E'🚚 Order Delivered'
    WHEN 'cancelled' THEN E'❌ Order Cancelled'
    ELSE notification_title
  END,
  notification_body = CASE status_key
    WHEN 'accepted' THEN '{seller_name} has accepted your order.'
    WHEN 'preparing' THEN '{seller_name} is preparing your order.'
    WHEN 'ready' THEN 'Your order from {seller_name} is ready.'
    WHEN 'on_the_way' THEN '{seller_name} is on the way with your order.'
    WHEN 'delivered' THEN 'Your order from {seller_name} has been delivered.'
    WHEN 'cancelled' THEN 'Your order was cancelled.'
    ELSE notification_body
  END
WHERE parent_group = 'default'
  AND transaction_type IN ('seller_delivery', 'delivery', 'self_pickup')
  AND notify_buyer = true
  AND btrim(coalesce(notification_title, '')) = '';

UPDATE public.category_status_flows
SET
  seller_notification_title = E'🆕 New Order Received!',
  seller_notification_body = 'You have a new order from {buyer_name} (#{order_number}).'
WHERE parent_group = 'default'
  AND transaction_type IN ('seller_delivery', 'delivery', 'self_pickup')
  AND status_key = 'placed'
  AND notify_seller = true
  AND btrim(coalesce(seller_notification_title, '')) = '';

-- Heal existing blank inbox rows.
UPDATE public.user_notifications un
SET
  title = CASE
    WHEN btrim(coalesce(un.title, '')) <> '' THEN un.title
    WHEN coalesce(un.data->>'status', un.data->>'new_status', un.payload->>'status', un.payload->>'new_status') = 'accepted' THEN E'✅ Order Accepted!'
    WHEN coalesce(un.data->>'status', un.data->>'new_status', un.payload->>'status', un.payload->>'new_status') = 'placed' THEN E'🆕 New Order Received!'
    ELSE 'Order Update'
  END,
  body = CASE
    WHEN btrim(coalesce(un.body, '')) <> '' THEN un.body
    WHEN coalesce(un.data->>'status', un.data->>'new_status', un.payload->>'status', un.payload->>'new_status') = 'accepted'
      THEN coalesce(un.data->>'sellerName', un.data->>'providerName', un.payload->>'sellerName', 'The seller') || ' has accepted your order.'
    WHEN btrim(coalesce(un.data->>'item_summary', un.payload->>'item_summary', '')) <> ''
      THEN un.data->>'item_summary'
    ELSE 'Tap to view order details.'
  END
WHERE un.type IN ('order', 'order_status', 'order_update')
  AND (btrim(coalesce(un.title, '')) = '' OR btrim(coalesce(un.body, '')) = '');

-- Re-enqueue seller new-order notification for the live missed order (idempotent).
SELECT public.enqueue_seller_new_order_notification('a3af7b85-420b-4ffa-86f6-c767ccd44b50'::uuid);
