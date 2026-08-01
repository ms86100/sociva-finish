
-- ============================================================
-- 1. INSERT MISSING default/cart_purchase TRANSITIONS
-- ============================================================
DELETE FROM public.category_status_transitions
WHERE parent_group = 'default' AND transaction_type = 'cart_purchase';

INSERT INTO public.category_status_transitions (parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action, allowed_roles)
VALUES
  ('default','cart_purchase','placed','accepted','seller',false,'{seller}'),
  ('default','cart_purchase','placed','cancelled','buyer',true,'{seller}'),
  ('default','cart_purchase','accepted','preparing','seller',false,'{seller}'),
  ('default','cart_purchase','accepted','cancelled','seller',true,'{seller}'),
  ('default','cart_purchase','preparing','ready','seller',false,'{seller}'),
  ('default','cart_purchase','preparing','cancelled','seller',true,'{seller}'),
  ('default','cart_purchase','ready','assigned','system',false,'{seller}'),
  ('default','cart_purchase','ready','picked_up','delivery',false,'{seller}'),
  ('default','cart_purchase','assigned','picked_up','delivery',false,'{seller}'),
  ('default','cart_purchase','picked_up','on_the_way','delivery',false,'{seller}'),
  ('default','cart_purchase','on_the_way','at_gate','delivery',false,'{seller}'),
  ('default','cart_purchase','on_the_way','failed','delivery',true,'{seller}'),
  ('default','cart_purchase','at_gate','delivered','buyer',false,'{seller}'),
  ('default','cart_purchase','at_gate','buyer_received','buyer',false,'{seller}'),
  ('default','cart_purchase','buyer_received','delivered','delivery',false,'{seller}'),
  ('default','cart_purchase','delivered','payment_pending','system',false,'{seller}'),
  ('default','cart_purchase','delivered','completed','system',false,'{seller}'),
  ('default','cart_purchase','payment_pending','completed','buyer',false,'{seller}');

-- ============================================================
-- 2. INSERT MISSING default/seller_delivery TRANSITIONS
-- ============================================================
INSERT INTO public.category_status_transitions (parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action, allowed_roles)
VALUES
  ('default','seller_delivery','placed','accepted','seller',false,'{seller}'),
  ('default','seller_delivery','placed','cancelled','buyer',true,'{seller}'),
  ('default','seller_delivery','accepted','preparing','seller',false,'{seller}'),
  ('default','seller_delivery','accepted','cancelled','seller',true,'{seller}'),
  ('default','seller_delivery','preparing','ready','seller',false,'{seller}'),
  ('default','seller_delivery','preparing','cancelled','seller',true,'{seller}'),
  ('default','seller_delivery','ready','on_the_way','seller',false,'{seller}'),
  ('default','seller_delivery','on_the_way','at_gate','seller',false,'{seller}'),
  ('default','seller_delivery','at_gate','delivered','buyer',false,'{seller}'),
  ('default','seller_delivery','at_gate','buyer_received','buyer',false,'{seller}'),
  ('default','seller_delivery','buyer_received','delivered','seller',false,'{seller}'),
  ('default','seller_delivery','delivered','payment_pending','system',false,'{seller}'),
  ('default','seller_delivery','delivered','completed','system',false,'{seller}'),
  ('default','seller_delivery','payment_pending','completed','buyer',false,'{seller}');

-- ============================================================
-- 3. BACKFILL transaction_type ON EXISTING ORDERS
-- ============================================================
UPDATE public.orders SET transaction_type = 'self_fulfillment'
WHERE transaction_type IS NULL AND fulfillment_type = 'self_pickup';

UPDATE public.orders SET transaction_type = 'seller_delivery'
WHERE transaction_type IS NULL AND fulfillment_type IN ('seller_delivery', 'delivery');

UPDATE public.orders SET transaction_type = 'self_fulfillment'
WHERE transaction_type IS NULL;

-- ============================================================
-- 4. ADD scheduled_time COLUMN IF MISSING
-- ============================================================
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS scheduled_time TIME WITHOUT TIME ZONE;

-- ============================================================
-- 5. HELPER: map parent_group slugs to transition parent_groups
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_transition_parent_group(_pg TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _pg
    WHEN 'food' THEN 'food_beverages'
    WHEN 'classes' THEN 'education_learning'
    WHEN 'personal' THEN 'personal_care'
    WHEN 'services' THEN 'home_services'
    WHEN 'resale' THEN 'default'
    WHEN 'property' THEN 'default'
    WHEN 'rentals' THEN 'default'
    ELSE COALESCE(_pg, 'default')
  END;
$$;

-- ============================================================
-- 6. REPLACE validate_order_status_transition
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _raw_pg TEXT;
  _parent_group TEXT;
  _txn_type TEXT;
  _valid BOOLEAN;
  _listing_type TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF OLD.status::text = 'payment_pending' THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status::text = 'cancelled' AND current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT sp.primary_group INTO _raw_pg
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := resolve_transition_parent_group(_raw_pg);

  -- Prefer stored transaction_type
  IF NEW.transaction_type IS NOT NULL THEN
    _txn_type := NEW.transaction_type;
  ELSE
    SELECT p.listing_type INTO _listing_type
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.id LIMIT 1;

    IF _listing_type = 'contact_only' THEN _txn_type := 'contact_enquiry';
    ELSIF NEW.order_type = 'enquiry' THEN
      IF _parent_group IN ('education_learning','events') THEN _txn_type := 'service_booking';
      ELSE _txn_type := 'request_service'; END IF;
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type = 'self_pickup' THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by,'seller') = 'seller' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE parent_group = _parent_group AND transaction_type = _txn_type
      AND from_status = OLD.status::text AND to_status = NEW.status::text
  ) INTO _valid;

  IF NOT _valid AND _parent_group != 'default' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = 'default' AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
    ) INTO _valid;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%)',
      OLD.status, NEW.status, _parent_group, _txn_type;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ============================================================
-- 7. REPLACE seller_advance_order (with parent_group mapping)
-- ============================================================
CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id UUID,
  _new_status order_status,
  _rejection_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_valid BOOLEAN;
BEGIN
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status, o.transaction_type,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  -- Resolve transaction_type (prefer stored)
  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := v_order.transaction_type;
  ELSE
    SELECT p.listing_type INTO v_listing_type
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = _order_id LIMIT 1;

    IF v_listing_type = 'contact_only' THEN v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning','events') THEN v_transaction_type := 'service_booking';
      ELSE v_transaction_type := 'request_service'; END IF;
    ELSIF v_order.order_type = 'booking' THEN v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery') THEN v_transaction_type := 'seller_delivery';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = _new_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to %', v_order.status, _new_status;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = _new_status,
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id AND status = v_order.status;
END;
$fn$;

-- ============================================================
-- 8. CREATE verify_delivery_otp_and_complete RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.verify_delivery_otp_and_complete(
  _order_id UUID,
  _delivery_code TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _order RECORD;
  _assignment RECORD;
  _caller_id UUID := auth.uid();
  _is_seller BOOLEAN := false;
  _is_rider BOOLEAN := false;
  _current_sort INT;
  _next_step RECORD;
  _txn_type TEXT;
  _parent_group TEXT;
BEGIN
  SELECT o.*, sp.user_id AS seller_user_id, sp.primary_group
  INTO _order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;

  IF _order.seller_user_id = _caller_id THEN _is_seller := true; END IF;

  SELECT * INTO _assignment FROM delivery_assignments
  WHERE order_id = _order_id ORDER BY created_at DESC LIMIT 1;

  IF _assignment.id IS NOT NULL AND _assignment.rider_id = _caller_id::text THEN _is_rider := true; END IF;
  IF NOT _is_seller AND NOT _is_rider THEN RAISE EXCEPTION 'Not authorized'; END IF;

  IF _assignment.id IS NULL OR _assignment.delivery_code IS NULL THEN
    RAISE EXCEPTION 'No delivery code found';
  END IF;

  IF _assignment.delivery_code != _delivery_code THEN
    UPDATE delivery_assignments SET otp_attempt_count = otp_attempt_count + 1 WHERE id = _assignment.id;
    RAISE EXCEPTION 'Invalid delivery code';
  END IF;

  _parent_group := resolve_transition_parent_group(_order.primary_group);
  _txn_type := COALESCE(_order.transaction_type, 'self_fulfillment');

  SELECT sort_order INTO _current_sort FROM category_status_flows
  WHERE transaction_type = _txn_type AND parent_group = _parent_group AND status_key = _order.status::text LIMIT 1;

  IF _current_sort IS NULL THEN
    SELECT sort_order INTO _current_sort FROM category_status_flows
    WHERE transaction_type = _txn_type AND parent_group = 'default' AND status_key = _order.status::text LIMIT 1;
    _parent_group := 'default';
  END IF;

  IF _current_sort IS NULL THEN RAISE EXCEPTION 'Cannot find current step for status %', _order.status; END IF;

  SELECT * INTO _next_step FROM category_status_flows
  WHERE transaction_type = _txn_type AND parent_group = _parent_group
    AND sort_order > _current_sort AND NOT is_deprecated
  ORDER BY sort_order ASC LIMIT 1;

  IF _next_step.id IS NULL THEN RAISE EXCEPTION 'No next step after %', _order.status; END IF;

  PERFORM set_config('app.otp_verified', 'true', true);
  PERFORM set_config('app.acting_as', CASE WHEN _is_seller THEN 'seller' ELSE 'delivery' END, true);

  UPDATE orders SET status = _next_step.status_key::order_status, updated_at = now() WHERE id = _order_id;

  UPDATE delivery_assignments
  SET otp_verified = true, status = _next_step.status_key,
      delivered_at = CASE WHEN _next_step.status_key IN ('delivered','completed') THEN now() ELSE delivered_at END,
      updated_at = now()
  WHERE id = _assignment.id;

  RETURN _next_step.status_key;
END;
$fn$;

-- ============================================================
-- 9. REPLACE enforce_otp_gate (workflow-aware)
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_otp_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _otp_type TEXT;
  _txn_type TEXT;
  _parent_group TEXT;
  _has_delivery_code BOOLEAN;
  _otp_verified BOOLEAN;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT resolve_transition_parent_group(sp.primary_group) INTO _parent_group
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;
  _parent_group := COALESCE(_parent_group, 'default');
  _txn_type := COALESCE(NEW.transaction_type, 'self_fulfillment');

  SELECT csf.otp_type INTO _otp_type FROM category_status_flows csf
  WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group
    AND csf.status_key = NEW.status::text LIMIT 1;

  IF _otp_type IS NULL THEN
    SELECT csf.otp_type INTO _otp_type FROM category_status_flows csf
    WHERE csf.transaction_type = _txn_type AND csf.parent_group = 'default'
      AND csf.status_key = NEW.status::text LIMIT 1;
  END IF;

  IF _otp_type IS NULL OR _otp_type = '' THEN RETURN NEW; END IF;

  IF _otp_type = 'delivery' THEN
    SELECT EXISTS (SELECT 1 FROM delivery_assignments WHERE order_id = NEW.id AND delivery_code IS NOT NULL)
    INTO _has_delivery_code;
    IF NOT _has_delivery_code THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Delivery OTP verification required. Use verify_delivery_otp_and_complete RPC.';
  END IF;

  IF _otp_type = 'generic' THEN
    SELECT EXISTS (SELECT 1 FROM order_otp_codes WHERE order_id = NEW.id AND target_status = NEW.status::text AND verified = true)
    INTO _otp_verified;
    IF NOT _otp_verified THEN
      RAISE EXCEPTION 'OTP verification required. Use verify_generic_otp_and_advance RPC.';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ============================================================
-- 10. REPLACE fn_enqueue_order_status_notification (workflow-driven)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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

  SELECT full_name INTO _buyer_name FROM profiles WHERE id = NEW.buyer_id;
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
$fn$;

-- ============================================================
-- 11. DROP DUPLICATE NOTIFICATION TRIGGERS, CONSOLIDATE
-- ============================================================
DROP TRIGGER IF EXISTS trg_enqueue_order_notification ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_order_placed_notification ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_order_notification_insert ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification ON public.orders;
DROP TRIGGER IF EXISTS trg_enqueue_order_status_notification ON public.orders;

CREATE TRIGGER trg_enqueue_order_status_notification
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_enqueue_order_status_notification();

-- Also drop the enforce_delivery_otp trigger (now handled by enforce_otp_gate)
DROP TRIGGER IF EXISTS trg_enforce_delivery_otp ON public.orders;
