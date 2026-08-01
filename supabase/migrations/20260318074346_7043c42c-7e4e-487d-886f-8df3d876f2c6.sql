-- Fix validate_order_status_transition: respect delivery_handled_by
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _parent_group text;
  _txn_type text;
  _valid boolean;
  _actors text[];
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'cancelled' THEN
    IF current_setting('role', true) = 'service_role' THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT sp.primary_group INTO _parent_group
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  IF NEW.order_type = 'enquiry' THEN
    IF _parent_group IN ('classes', 'events') THEN
      _txn_type := 'book_slot';
    ELSE
      _txn_type := 'request_service';
    END IF;
  ELSIF NEW.order_type = 'booking' THEN
    _txn_type := 'service_booking';
  ELSIF NEW.fulfillment_type IN ('self_pickup', 'seller_delivery') THEN
    _txn_type := 'self_fulfillment';
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN
    _txn_type := 'self_fulfillment';
  ELSE
    _txn_type := 'cart_purchase';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE parent_group = COALESCE(_parent_group, 'default')
      AND transaction_type = _txn_type
      AND from_status = OLD.status::text
      AND to_status = NEW.status::text
  ) INTO _valid;

  IF NOT _valid AND _parent_group IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = 'default'
        AND transaction_type = _txn_type
        AND from_status = OLD.status::text
        AND to_status = NEW.status::text
    ) INTO _valid;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%"', OLD.status, NEW.status;
  END IF;

  SELECT array_agg(DISTINCT cst.allowed_actor) INTO _actors
  FROM public.category_status_transitions cst
  WHERE (cst.parent_group = COALESCE(_parent_group, 'default') OR cst.parent_group = 'default')
    AND cst.transaction_type = _txn_type
    AND cst.from_status = OLD.status::text
    AND cst.to_status = NEW.status::text;

  IF _actors IS NOT NULL
     AND NOT ('seller' = ANY(_actors) OR 'buyer' = ANY(_actors) OR 'admin' = ANY(_actors))
     AND ('delivery' = ANY(_actors) OR 'system' = ANY(_actors)) THEN
    IF coalesce(current_setting('app.delivery_sync', true), '') != 'true'
       AND current_setting('role', true) != 'service_role' THEN
      RAISE EXCEPTION 'Status transition to "%" can only be performed by the delivery/system', NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix fn_enqueue_order_status_notification: respect delivery_handled_by
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
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
         csf.seller_notification_title, csf.seller_notification_body
  INTO v_title, v_body, v_action, v_seller_title, v_seller_body
  FROM public.category_status_flows csf
  WHERE csf.parent_group = v_parent_group
    AND csf.transaction_type = v_transaction_type
    AND csf.status_key = NEW.status
    AND (csf.notify_buyer = true OR csf.notify_seller = true);

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