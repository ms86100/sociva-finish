-- Home App Update notice (in-app banner only, not a push campaign)
-- and buyer push when a seller confirms a scheduled or confirmed order.

CREATE TABLE IF NOT EXISTS public.app_update_notices (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT 'A better Sociva is ready',
  message text NOT NULL DEFAULT 'Update the app to see the latest menus, orders, and delivery updates.',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_update_notices (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_update_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_update_notices_read ON public.app_update_notices;
CREATE POLICY app_update_notices_read
  ON public.app_update_notices
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS app_update_notices_admin_update ON public.app_update_notices;
CREATE POLICY app_update_notices_admin_update
  ON public.app_update_notices
  FOR UPDATE
  TO authenticated
  USING (public.has_role((select auth.uid()), 'admin'))
  WITH CHECK (public.has_role((select auth.uid()), 'admin'));

GRANT SELECT ON public.app_update_notices TO anon, authenticated;
GRANT UPDATE ON public.app_update_notices TO authenticated;

-- Food and delivery scheduled confirmations were missing a flow row, so the
-- buyer push was skipped. Service-booking rows already exist and are left as-is.
INSERT INTO public.category_status_flows (
  transaction_type, parent_group, status_key, display_name, statuses,
  notify_buyer, notify_seller, notification_title, notification_body,
  display_label, buyer_display_label, seller_display_label
)
SELECT
  v.transaction_type,
  v.parent_group,
  'scheduled',
  'Scheduled',
  ARRAY['scheduled']::text[],
  true,
  false,
  'Order confirmed',
  '{seller_name} confirmed your order.',
  'Scheduled',
  'Scheduled',
  'Scheduled'
FROM (
  VALUES
    ('seller_delivery', 'default'),
    ('seller_delivery', 'food_beverages'),
    ('delivery', 'default'),
    ('delivery', 'food_beverages'),
    ('self_fulfillment', 'default'),
    ('self_fulfillment', 'food_beverages')
) AS v(transaction_type, parent_group)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.category_status_flows existing
  WHERE existing.transaction_type = v.transaction_type
    AND existing.parent_group = v.parent_group
    AND existing.status_key = 'scheduled'
);

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
       'picked_up', 'ready', 'delivered', 'completed', 'rescheduled', 'provider_changed',
       'scheduled', 'confirmed'
     ])
     AND (_flow.id IS NULL OR NOT COALESCE(_flow.notify_buyer, false))
  THEN
    _fallback_buyer := true;
    _buyer_title := CASE NEW.status::text
      WHEN 'assigned' THEN chr(128100) || ' Provider Assigned'
      WHEN 'provider_changed' THEN chr(128260) || ' Provider Updated'
      WHEN 'on_the_way' THEN chr(128757) || ' On The Way'
      WHEN 'arrived' THEN chr(127968) || ' Provider Arrived'
      WHEN 'in_progress' THEN chr(128295) || ' Service Started'
      WHEN 'at_gate' THEN chr(127968) || ' At Your Gate'
      WHEN 'picked_up' THEN chr(128230) || ' Order Picked Up'
      WHEN 'ready' THEN chr(127881) || ' Order Ready'
      WHEN 'delivered' THEN chr(128666) || ' Delivered'
      WHEN 'completed' THEN chr(11088) || ' Completed'
      WHEN 'rescheduled' THEN chr(128197) || ' Rescheduled'
      WHEN 'scheduled' THEN 'Order confirmed'
      WHEN 'confirmed' THEN 'Order confirmed'
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
      WHEN 'scheduled' THEN COALESCE(_seller_name, 'The seller') || ' confirmed your order.'
      WHEN 'confirmed' THEN COALESCE(_seller_name, 'The seller') || ' confirmed your order.'
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
    VALUES (NEW.buyer_id, chr(9989) || ' Order Confirmed!',
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
      _buyer_title := chr(10060) || ' Order Cancelled by Seller';
      _buyer_body := COALESCE(NEW.rejection_reason, 'Your order was cancelled by the seller.');
    END IF;
    IF NEW.transaction_type IN ('seller_delivery', 'delivery', 'self_fulfillment', 'self_pickup')
       AND NEW.status::text IN ('scheduled', 'confirmed') THEN
      _buyer_title := 'Order confirmed';
      _buyer_body := COALESCE(_seller_name, 'The seller') || ' confirmed your order';
      IF NEW.scheduled_date IS NOT NULL THEN
        _buyer_body := _buyer_body || ' for ' || to_char(NEW.scheduled_date, 'FMDD Mon YYYY');
      END IF;
      _buyer_body := _buyer_body || '.';
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
    VALUES (NEW.buyer_id, chr(128722) || ' Order Placed', 'Your order has been placed successfully.', 'order_status',
      '/orders/' || NEW.id::text,
      jsonb_build_object('order_id', NEW.id, 'orderId', NEW.id, 'new_status', NEW.status::text, 'status', NEW.status::text, 'target_role', 'buyer', 'wa_template', 'sociva_order_update'));
  END IF;

  IF _seller_user_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND NOT _is_auto_accepted THEN
      INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
      VALUES (_seller_user_id, chr(127381) || ' New Order Received!',
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
        _seller_title := chr(10060) || ' Order Cancelled by Buyer';
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

-- One missed live confirmation. Do not backfill older orders.
INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
SELECT
  o.buyer_id,
  'Order confirmed',
  sp.business_name || ' confirmed your order'
    || CASE
         WHEN o.scheduled_date IS NULL THEN ''
         ELSE ' for ' || to_char(o.scheduled_date, 'FMDD Mon YYYY')
       END
    || '.',
  'order_status',
  '/orders/' || o.id::text,
  jsonb_build_object(
    'order_id', o.id,
    'orderId', o.id,
    'new_status', 'scheduled',
    'status', 'scheduled',
    'target_role', 'buyer',
    'sellerName', sp.business_name,
    'wa_template', 'sociva_booking_confirmed'
  )
FROM public.orders o
JOIN public.seller_profiles sp ON sp.id = o.seller_id
WHERE sp.business_name ILIKE 'Tadka Ghar%'
  AND o.status = 'scheduled'
  AND o.created_at > now() - interval '3 days'
  AND NOT EXISTS (
    SELECT 1
    FROM public.notification_queue nq
    WHERE nq.user_id = o.buyer_id
      AND (nq.payload->>'order_id' = o.id::text OR nq.payload->>'orderId' = o.id::text)
      AND coalesce(nq.payload->>'new_status', nq.payload->>'status') = 'scheduled'
  );
