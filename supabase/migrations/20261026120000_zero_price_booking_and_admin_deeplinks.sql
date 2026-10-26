-- 1) Allow ₹0 service bookings (price on request / complimentary consults).
-- 2) Point admin moderation pushes at the right Admin tabs instead of bare /admin.

CREATE OR REPLACE FUNCTION public.create_service_booking_atomic(
  _seller_id uuid,
  _product_id uuid,
  _slot_id uuid,
  _booking_date text,
  _start_time text,
  _end_time text,
  _total_amount numeric,
  _product_name text,
  _unit_price numeric,
  _idempotency_key text,
  _notes text DEFAULT NULL,
  _buyer_address text DEFAULT NULL,
  _location_type text DEFAULT 'at_seller',
  _fulfillment_type text DEFAULT NULL,
  _addons jsonb DEFAULT '[]'::jsonb,
  _recurring jsonb DEFAULT NULL,
  _selected_extras jsonb DEFAULT '[]'::jsonb,
  _coupon_id text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _order_id uuid;
  _booking_id uuid;
  _slot_result json;
  _addon jsonb;
  _existing_order uuid;
  _seller_user uuid;
  _gate jsonb;
  _extras jsonb := COALESCE(_selected_extras, '[]'::jsonb);
  _extra_text text := public.format_selected_extras(COALESCE(_selected_extras, '[]'::jsonb));
  _combined_notes text;
  _db_price numeric;
  _addon_sum numeric := 0;
  _merchandise numeric;
  _resolved_coupon_id uuid;
  _coupon_row public.coupons%ROWTYPE;
  _user_redemption_count int := 0;
  _coupon_discount numeric := 0;
  _final_total numeric;
BEGIN
  IF _caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM seller_profiles WHERE id = _seller_id AND user_id = _caller) THEN
    RETURN json_build_object('success', false, 'error', 'Cannot book your own service');
  END IF;

  _gate := public.seller_credit_can_accept(_seller_id, 'SERVICE_BOOKING');
  IF COALESCE((_gate->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'error', COALESCE(_gate->>'reason', public.seller_credit_customer_reason('SERVICE_BOOKING')));
  END IF;

  SELECT id INTO _existing_order
  FROM orders
  WHERE buyer_id = _caller AND idempotency_key = _idempotency_key
  LIMIT 1;

  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object(
      'success', true,
      'order_id', _existing_order,
      'booking_id', _booking_id,
      'idempotent', true
    );
  END IF;

  SELECT price INTO _db_price
  FROM public.products
  WHERE id = _product_id
    AND seller_id = _seller_id
  LIMIT 1;

  IF _addons IS NOT NULL AND jsonb_typeof(_addons) = 'array' THEN
    SELECT COALESCE(SUM(COALESCE((a->>'price')::numeric, 0)), 0)
      INTO _addon_sum
    FROM jsonb_array_elements(_addons) AS a;
  END IF;

  _merchandise := ROUND(COALESCE(_db_price, _unit_price, 0) + COALESCE(_addon_sum, 0), 2);
  -- Allow ₹0 (price on request / complimentary). Only reject negative totals.
  IF _merchandise < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid service price');
  END IF;

  _resolved_coupon_id := NULLIF(TRIM(COALESCE(_coupon_id, '')), '')::uuid;
  IF _resolved_coupon_id IS NOT NULL THEN
    SELECT * INTO _coupon_row FROM public.coupons WHERE id = _resolved_coupon_id;

    IF _coupon_row.id IS NULL
       OR NOT _coupon_row.is_active
       OR _coupon_row.seller_id IS DISTINCT FROM _seller_id
       OR (_coupon_row.expires_at IS NOT NULL AND _coupon_row.expires_at < now())
       OR _coupon_row.starts_at > now()
       OR (_coupon_row.usage_limit IS NOT NULL AND _coupon_row.times_used >= _coupon_row.usage_limit)
    THEN
      RETURN json_build_object('success', false, 'error', 'Invalid or ineligible coupon');
    END IF;

    SELECT count(*)::int INTO _user_redemption_count
    FROM public.coupon_redemptions
    WHERE coupon_id = _resolved_coupon_id AND user_id = _caller;

    IF _user_redemption_count >= COALESCE(_coupon_row.per_user_limit, 1) THEN
      RETURN json_build_object('success', false, 'error', 'You have already used this coupon');
    END IF;

    IF _coupon_row.min_order_amount IS NOT NULL
       AND _coupon_row.min_order_amount > 0
       AND _merchandise < _coupon_row.min_order_amount THEN
      RETURN json_build_object('success', false, 'error', 'Order does not meet coupon minimum');
    END IF;

    IF lower(COALESCE(_coupon_row.discount_type, '')) = 'percentage' THEN
      _coupon_discount := (_merchandise * LEAST(_coupon_row.discount_value, 100)) / 100;
      IF _coupon_row.max_discount_amount IS NOT NULL THEN
        _coupon_discount := LEAST(_coupon_discount, _coupon_row.max_discount_amount);
      END IF;
    ELSE
      _coupon_discount := LEAST(_coupon_row.discount_value, _merchandise);
    END IF;
    _coupon_discount := ROUND(GREATEST(_coupon_discount, 0), 2);
  END IF;

  _final_total := ROUND(GREATEST(_merchandise - COALESCE(_coupon_discount, 0), 0), 2);

  _combined_notes := NULLIF(LEFT(trim(both FROM
    COALESCE(_notes, '') || CASE WHEN _extra_text <> '' THEN E'\n\nExtra details\n' || _extra_text ELSE '' END
  ), 800), '');

  INSERT INTO orders (
    buyer_id, seller_id, total_amount, order_type, status,
    payment_type, payment_status, transaction_type, idempotency_key,
    notes, delivery_address, fulfillment_type, selected_extras,
    coupon_id, coupon_discount, discount_amount
  ) VALUES (
    _caller, _seller_id, _final_total, 'booking', 'confirmed',
    'cod', 'pending', 'service_booking', _idempotency_key,
    _combined_notes,
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    COALESCE(_fulfillment_type, _location_type, 'at_seller'),
    _extras,
    _resolved_coupon_id,
    COALESCE(_coupon_discount, 0),
    COALESCE(_coupon_discount, 0)
  )
  RETURNING id INTO _order_id;

  INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, selected_extras)
  VALUES (_order_id, _product_id, _product_name, 1, COALESCE(_db_price, _unit_price), _extras);

  _slot_result := public.book_service_slot(
    _order_id, _slot_id, _caller, _seller_id, _product_id,
    _booking_date, _start_time, _end_time,
    COALESCE(_location_type, 'at_seller'),
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    _combined_notes
  );

  IF COALESCE((_slot_result->>'success')::boolean, false) IS NOT TRUE THEN
    UPDATE orders SET status = 'cancelled', notes = COALESCE(notes, '') || ' [booking_setup_failed]'
    WHERE id = _order_id;
    RETURN json_build_object(
      'success', false,
      'error', COALESCE(_slot_result->>'error', 'Failed to book slot'),
      'order_id', _order_id
    );
  END IF;

  _booking_id := (_slot_result->>'booking_id')::uuid;

  UPDATE public.service_bookings
  SET selected_extras = _extras
  WHERE id = _booking_id;

  IF _addons IS NOT NULL AND jsonb_typeof(_addons) = 'array' THEN
    FOR _addon IN SELECT * FROM jsonb_array_elements(_addons)
    LOOP
      INSERT INTO service_booking_addons (booking_id, addon_id, addon_name, addon_price)
      VALUES (
        _booking_id,
        NULLIF(_addon->>'id', '')::uuid,
        COALESCE(_addon->>'name', 'Add-on'),
        COALESCE((_addon->>'price')::numeric, 0)
      );
    END LOOP;
  END IF;

  IF _recurring IS NOT NULL AND COALESCE((_recurring->>'enabled')::boolean, false) THEN
    INSERT INTO service_recurring_configs (
      booking_id, buyer_id, seller_id, product_id,
      frequency, preferred_time, start_date, end_date, day_of_week
    ) VALUES (
      _booking_id, _caller, _seller_id, _product_id,
      COALESCE(_recurring->>'frequency', 'weekly'),
      _start_time::time,
      _booking_date::date,
      NULLIF(_recurring->>'endDate', '')::date,
      COALESCE((_recurring->>'dayOfWeek')::int, EXTRACT(DOW FROM _booking_date::date)::int)
    );
  END IF;

  IF _resolved_coupon_id IS NOT NULL AND _coupon_discount > 0 THEN
    INSERT INTO public.coupon_redemptions (coupon_id, user_id, order_id, discount_applied)
    VALUES (_resolved_coupon_id, _caller, _order_id, _coupon_discount);
    UPDATE public.coupons
    SET times_used = times_used + 1
    WHERE id = _resolved_coupon_id;
  END IF;

  SELECT user_id INTO _seller_user FROM seller_profiles WHERE id = _seller_id;
  IF _seller_user IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      _seller_user,
      'order',
      'New Booking Confirmed',
      'A customer booked ' || _product_name || ' on ' || _booking_date || ' at ' || LEFT(_start_time, 5),
      '/orders/' || _order_id::text,
      jsonb_build_object(
        'orderId', _order_id,
        'order_id', _order_id,
        'status', 'confirmed',
        'type', 'order',
        'target_role', 'seller',
        'high_priority', true
      )
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'order_id', _order_id,
    'booking_id', _booking_id,
    'idempotent', false,
    'coupon_discount', COALESCE(_coupon_discount, 0),
    'total_amount', _final_total
  );
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO _existing_order
  FROM orders WHERE buyer_id = _caller AND idempotency_key = _idempotency_key LIMIT 1;
  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object('success', true, 'order_id', _existing_order, 'booking_id', _booking_id, 'idempotent', true);
  END IF;
  RETURN json_build_object('success', false, 'error', SQLERRM);
WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_platform_admins_new_store_application(
  p_seller_user_id uuid,
  p_business_name text,
  p_seller_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store text := COALESCE(NULLIF(btrim(p_business_name), ''), 'A store');
  v_key text;
  v_path text := '/admin?tab=sellers';
BEGIN
  IF p_seller_user_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.is_admin(auth.uid())
     AND auth.uid() IS DISTINCT FROM p_seller_user_id THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF p_seller_id IS NOT NULL
     AND auth.uid() = p_seller_user_id
     AND NOT public.is_admin(auth.uid()) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.seller_profiles sp
      WHERE sp.id = p_seller_id
        AND sp.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not allowed';
    END IF;
  END IF;

  v_key := 'admin_new_store:' || COALESCE(p_seller_id::text, p_seller_user_id::text);

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  )
  SELECT
    ur.user_id,
    'New Store Application',
    '"' || v_store || '" has been submitted for review. Tap to moderate.',
    'moderation',
    v_path,
    jsonb_build_object(
      'type', 'new_store_application',
      'target_role', 'admin',
      'seller_id', p_seller_id,
      'seller_user_id', p_seller_user_id,
      'reference_path', v_path,
      'action_url', v_path
    ),
    v_key || ':' || ur.user_id::text
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id IS DISTINCT FROM p_seller_user_id
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_platform_admins_category_request(
  p_requester_user_id uuid,
  p_requested_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text := COALESCE(NULLIF(btrim(p_requested_name), ''), 'a category');
  v_key text;
  v_path text := '/admin?tab=catalog';
BEGIN
  IF p_requester_user_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_requester_user_id THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  v_key := 'admin_category_request:' || md5(v_name || ':' || p_requester_user_id::text);

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, idempotency_key
  )
  SELECT
    ur.user_id,
    'New category request',
    'A seller requested "' || v_name || '". Tap to review in Catalog.',
    'moderation',
    v_path,
    jsonb_build_object(
      'type', 'category_request',
      'target_role', 'admin',
      'requested_name', v_name,
      'requester_user_id', p_requester_user_id,
      'reference_path', v_path,
      'action_url', v_path
    ),
    v_key || ':' || ur.user_id::text
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
    AND ur.user_id IS DISTINCT FROM p_requester_user_id
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_product_review_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _seller_name text;
  _admin_row record;
  _path text := '/admin?tab=sellers';
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.approval_status IS NOT DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT sp.business_name INTO _seller_name
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  _seller_name := COALESCE(_seller_name, 'Unknown Store');

  FOR _admin_row IN
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin'
  LOOP
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _admin_row.user_id,
      'New Product for Review',
      '"' || COALESCE(NEW.name, 'A product') || '" from "' || _seller_name || '" needs review.',
      'moderation',
      _path,
      jsonb_build_object(
        'type', 'product_review',
        'productId', NEW.id,
        'reference_path', _path,
        'action_url', _path
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Fix existing admin inbox/queue rows that still point at bare /admin.
UPDATE public.user_notifications un
SET
  reference_path = CASE
    WHEN COALESCE(un.payload->>'type', '') = 'category_request' THEN '/admin?tab=catalog'
    WHEN COALESCE(un.payload->>'type', '') = 'user_feedback' THEN '/admin?tab=feedback'
    ELSE '/admin?tab=sellers'
  END,
  action_url = CASE
    WHEN COALESCE(un.payload->>'type', '') = 'category_request' THEN '/admin?tab=catalog'
    WHEN COALESCE(un.payload->>'type', '') = 'user_feedback' THEN '/admin?tab=feedback'
    ELSE '/admin?tab=sellers'
  END
WHERE un.type = 'moderation'
  AND COALESCE(un.reference_path, un.action_url, '') IN ('/admin', '/admin/');

UPDATE public.notification_queue nq
SET
  reference_path = CASE
    WHEN COALESCE(nq.payload->>'type', '') = 'category_request' THEN '/admin?tab=catalog'
    WHEN COALESCE(nq.payload->>'type', '') = 'user_feedback' THEN '/admin?tab=feedback'
    ELSE '/admin?tab=sellers'
  END
WHERE nq.type = 'moderation'
  AND COALESCE(nq.reference_path, '') IN ('/admin', '/admin/')
  AND nq.processed_at IS NULL;
