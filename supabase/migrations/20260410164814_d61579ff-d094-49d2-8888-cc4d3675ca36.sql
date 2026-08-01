
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM notification_queue
    WHERE payload->>'order_id' = NEW.id::text AND payload->>'new_status' = NEW.status::text
      AND created_at > now() - interval '30 seconds'
  ) INTO _dedupe_exists;
  IF _dedupe_exists THEN RETURN NEW; END IF;

  SELECT sp.user_id, sp.business_name, resolve_transition_parent_group(sp.primary_group)
  INTO _seller_user_id, _seller_name, _parent_group
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;
  _parent_group := COALESCE(_parent_group, 'default');
  _txn_type := COALESCE(NEW.transaction_type, 'self_fulfillment');

  -- FIX: use 'name' instead of 'full_name'
  SELECT name INTO _buyer_name FROM profiles WHERE id = NEW.buyer_id;
  _order_number := upper(right(NEW.id::text, 6));
  _acting_as := current_setting('app.acting_as', true);

  SELECT * INTO _flow FROM category_status_flows
  WHERE transaction_type = _txn_type AND parent_group = _parent_group AND status_key = NEW.status::text LIMIT 1;

  IF _flow.id IS NULL THEN
    SELECT * INTO _flow FROM category_status_flows
    WHERE transaction_type = _txn_type AND parent_group = 'default' AND status_key = NEW.status::text LIMIT 1;
  END IF;

  -- NOTIFY BUYER
  IF _flow.id IS NOT NULL AND _flow.notify_buyer THEN
    _buyer_title := COALESCE(_flow.notification_title, 'Order Update');
    _buyer_body := COALESCE(_flow.notification_body, 'Your order status changed to ' || NEW.status::text);
    _buyer_title := replace(replace(replace(_buyer_title,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);
    _buyer_body := replace(replace(replace(_buyer_body,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);

    IF NEW.status::text = 'cancelled' AND _acting_as = 'seller' THEN
      _buyer_title := '❌ Order Cancelled by Seller';
      _buyer_body := COALESCE(NEW.rejection_reason, 'Your order was cancelled by the seller.');
    END IF;

    INSERT INTO notification_queue (user_id, title, body, type, payload)
    VALUES (NEW.buyer_id, _buyer_title, _buyer_body, 'order_status',
      jsonb_build_object('order_id',NEW.id,'new_status',NEW.status::text,'old_status',CASE WHEN TG_OP='UPDATE' THEN OLD.status::text ELSE NULL END,'target_role','buyer'));
  ELSIF _flow.id IS NULL AND TG_OP = 'INSERT' THEN
    INSERT INTO notification_queue (user_id, title, body, type, payload)
    VALUES (NEW.buyer_id, '🛒 Order Placed', 'Your order has been placed successfully.', 'order_status',
      jsonb_build_object('order_id',NEW.id,'new_status',NEW.status::text,'target_role','buyer'));
  END IF;

  -- NOTIFY SELLER
  IF _seller_user_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO notification_queue (user_id, title, body, type, payload)
      VALUES (_seller_user_id, '🆕 New Order Received!',
        'You have a new order from ' || COALESCE(_buyer_name,'a customer') || ' (#' || _order_number || ')',
        'order_status', jsonb_build_object('order_id',NEW.id,'new_status',NEW.status::text,'target_role','seller'));
    ELSIF _flow.id IS NOT NULL AND _flow.notify_seller THEN
      _seller_title := COALESCE(_flow.seller_notification_title, 'Order Update');
      _seller_body := COALESCE(_flow.seller_notification_body, 'Order status changed to ' || NEW.status::text);
      _seller_title := replace(replace(replace(_seller_title,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);
      _seller_body := replace(replace(replace(_seller_body,'{seller_name}',COALESCE(_seller_name,'')),'{buyer_name}',COALESCE(_buyer_name,'')),'{order_number}',_order_number);

      IF NEW.status::text = 'cancelled' AND _acting_as = 'buyer' THEN
        _seller_title := '❌ Order Cancelled by Buyer';
        _seller_body := COALESCE(_buyer_name,'The buyer') || ' cancelled order #' || _order_number;
      END IF;

      INSERT INTO notification_queue (user_id, title, body, type, payload)
      VALUES (_seller_user_id, _seller_title, _seller_body, 'order_status',
        jsonb_build_object('order_id',NEW.id,'new_status',NEW.status::text,'target_role','seller'));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
