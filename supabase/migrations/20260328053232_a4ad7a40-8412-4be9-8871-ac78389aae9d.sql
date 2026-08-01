-- B: Unique indexes for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS unique_razorpay_payment_id
  ON public.payment_records (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_order_payment_record
  ON public.payment_records (order_id);

-- C: Data repair for order a8549579 (use correct column: payment_type)
INSERT INTO public.payment_records (order_id, buyer_id, seller_id, amount, payment_method, payment_status, platform_fee, net_amount, payment_collection, payment_mode)
SELECT o.id, o.buyer_id, o.seller_id, o.total_amount, 'online', o.payment_status, 0, o.total_amount, 'direct', 'online'
FROM public.orders o
WHERE o.id = 'a8549579-2db0-4e45-9bd9-520932f52cc5'
  AND NOT EXISTS (SELECT 1 FROM public.payment_records pr WHERE pr.order_id = o.id);

-- A: Replace RPC with fixed column names
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _society_id uuid,
  _seller_groups json,
  _payment_mode text DEFAULT 'cod',
  _payment_method text DEFAULT 'cod',
  _payment_status text DEFAULT 'pending',
  _delivery_address_id uuid DEFAULT null,
  _delivery_lat double precision DEFAULT null,
  _delivery_lng double precision DEFAULT null,
  _scheduled_date text DEFAULT null,
  _scheduled_time_start text DEFAULT null,
  _preorder_seller_ids uuid[] DEFAULT null,
  _idempotency_key text DEFAULT null
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _seller_group json;
  _seller_id uuid;
  _items json;
  _item json;
  _product_id uuid;
  _quantity int;
  _client_price numeric;
  _db_price numeric;
  _db_stock int;
  _db_available boolean;
  _db_approved boolean;
  _db_seller_id uuid;
  _order_id uuid;
  _order_ids uuid[] := '{}';
  _total numeric;
  _item_total numeric;
  _seller_name text;
  _seller_status jsonb;
  _seller_status_text text;
  _seller_lat double precision;
  _seller_lng double precision;
  _seller_radius double precision;
  _distance_km double precision;
  _delivery_fee numeric;
  _discount_amount numeric;
  _resolved_coupon_id uuid;
  _delivery_handled_by text;
  _transaction_type text;
  _group_count int;
  _row_idempotency_key text;
  _auto_cancel_at timestamptz;
  _effective_status text;
  _effective_scheduled_date text;
  _effective_scheduled_time text;
  _closed_sellers text[] := '{}';
  _out_of_range_sellers text[] := '{}';
  _unavailable_items text[] := '{}';
  _price_changed_items text[] := '{}';
  _stock_issues text[] := '{}';
BEGIN
  IF _buyer_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'auth_mismatch', 'message', 'Buyer ID does not match authenticated user');
  END IF;

  _group_count := json_array_length(_seller_groups);

  FOR _seller_group IN SELECT * FROM json_array_elements(_seller_groups)
  LOOP
    _seller_id := (_seller_group->>'seller_id')::uuid;

    SELECT sp.business_name,
           public.compute_store_status(sp.availability_start, sp.availability_end, sp.manual_override, sp.manual_override_until),
           sp.latitude, sp.longitude, sp.delivery_radius_km
      INTO _seller_name, _seller_status, _seller_lat, _seller_lng, _seller_radius
    FROM public.seller_profiles sp WHERE sp.id = _seller_id;

    _seller_status_text := _seller_status->>'status';

    IF _seller_status_text = 'closed' THEN
      _closed_sellers := array_append(_closed_sellers, COALESCE(_seller_name, _seller_id::text));
    END IF;

    IF _delivery_lat IS NOT NULL AND _delivery_lng IS NOT NULL AND _seller_lat IS NOT NULL AND _seller_lng IS NOT NULL THEN
      _distance_km := 6371 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(_delivery_lat)) * cos(radians(_seller_lat)) *
          cos(radians(_seller_lng) - radians(_delivery_lng)) +
          sin(radians(_delivery_lat)) * sin(radians(_seller_lat))
        ))
      );
      IF _seller_radius IS NOT NULL AND _seller_radius > 0 AND _distance_km > _seller_radius THEN
        _out_of_range_sellers := array_append(_out_of_range_sellers, COALESCE(_seller_name, _seller_id::text));
      END IF;
    END IF;

    FOR _item IN SELECT * FROM json_array_elements(_seller_group->'items')
    LOOP
      _product_id := (_item->>'product_id')::uuid;
      _quantity := (_item->>'quantity')::int;
      _client_price := (_item->>'unit_price')::numeric;

      SELECT p.price, p.stock_quantity, p.is_available, p.is_approved, p.seller_id
        INTO _db_price, _db_stock, _db_available, _db_approved, _db_seller_id
      FROM public.products p WHERE p.id = _product_id FOR UPDATE;

      IF _db_price IS NULL THEN
        _unavailable_items := array_append(_unavailable_items, _product_id::text);
        CONTINUE;
      END IF;

      IF _db_available = false OR _db_approved = false THEN
        _unavailable_items := array_append(_unavailable_items, _product_id::text);
        CONTINUE;
      END IF;

      IF _db_seller_id != _seller_id THEN
        _unavailable_items := array_append(_unavailable_items, _product_id::text);
        CONTINUE;
      END IF;

      IF abs(_db_price - _client_price) > 0.01 THEN
        _price_changed_items := array_append(_price_changed_items, _product_id::text);
      END IF;

      IF _db_stock IS NOT NULL AND _db_stock >= 0 AND _db_stock < _quantity THEN
        _stock_issues := array_append(_stock_issues, _product_id::text || ':' || _db_stock::text);
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(_closed_sellers, 1) > 0 THEN
    RETURN json_build_object('success', false, 'error', 'store_closed', 'sellers', _closed_sellers);
  END IF;
  IF array_length(_out_of_range_sellers, 1) > 0 THEN
    RETURN json_build_object('success', false, 'error', 'delivery_out_of_range', 'sellers', _out_of_range_sellers);
  END IF;
  IF array_length(_unavailable_items, 1) > 0 THEN
    RETURN json_build_object('success', false, 'error', 'unavailable_items', 'items', _unavailable_items);
  END IF;
  IF array_length(_price_changed_items, 1) > 0 THEN
    RETURN json_build_object('success', false, 'error', 'price_changed', 'items', _price_changed_items);
  END IF;
  IF array_length(_stock_issues, 1) > 0 THEN
    RETURN json_build_object('success', false, 'error', 'insufficient_stock', 'items', _stock_issues);
  END IF;

  _effective_status := CASE WHEN _payment_mode IN ('razorpay', 'upi') THEN 'payment_pending' ELSE 'placed' END;

  FOR _seller_group IN SELECT * FROM json_array_elements(_seller_groups)
  LOOP
    _seller_id := (_seller_group->>'seller_id')::uuid;
    _delivery_fee := coalesce((_seller_group->>'delivery_fee')::numeric, 0);
    _discount_amount := coalesce((_seller_group->>'discount_amount')::numeric, 0);
    _resolved_coupon_id := (_seller_group->>'coupon_id')::uuid;
    _delivery_handled_by := coalesce(_seller_group->>'delivery_handled_by', 'seller');
    _transaction_type := coalesce(_seller_group->>'transaction_type', 'delivery');

    _total := 0;
    FOR _item IN SELECT * FROM json_array_elements(_seller_group->'items')
    LOOP
      _product_id := (_item->>'product_id')::uuid;
      _quantity := (_item->>'quantity')::int;

      SELECT p.price INTO _db_price FROM public.products p WHERE p.id = _product_id;
      _total := _total + (_db_price * _quantity);
    END LOOP;

    _order_id := gen_random_uuid();
    _order_ids := array_append(_order_ids, _order_id);

    IF _idempotency_key IS NOT NULL THEN
      _row_idempotency_key := _idempotency_key || '::' || _seller_id::text;
    ELSE
      _row_idempotency_key := null;
    END IF;

    _auto_cancel_at := CASE WHEN _effective_status = 'payment_pending' THEN now() + interval '30 minutes' ELSE null END;

    IF _preorder_seller_ids IS NULL OR _seller_id = ANY(_preorder_seller_ids) THEN
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    ELSE
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    END IF;

    INSERT INTO public.orders (
      id, buyer_id, seller_id, society_id, status,
      total_amount, payment_mode, delivery_address_id,
      delivery_fee, discount_amount, coupon_id,
      delivery_handled_by, idempotency_key, auto_cancel_at,
      scheduled_date, scheduled_time_start, transaction_type
    )
    VALUES (
      _order_id, _buyer_id, _seller_id, _society_id, _effective_status,
      _total, _payment_mode, _delivery_address_id,
      _delivery_fee,
      CASE WHEN _group_count = 1 THEN _discount_amount ELSE 0 END,
      CASE WHEN _group_count = 1 THEN _resolved_coupon_id ELSE NULL END,
      _delivery_handled_by, _row_idempotency_key, _auto_cancel_at,
      NULLIF(_effective_scheduled_date, '')::date,
      NULLIF(_effective_scheduled_time, '')::time,
      _transaction_type
    )
    ON CONFLICT (buyer_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET updated_at = now()
    RETURNING id INTO _order_id;

    FOR _item IN SELECT * FROM json_array_elements(_seller_group->'items')
    LOOP
      _product_id := (_item->>'product_id')::uuid;
      _quantity := (_item->>'quantity')::int;

      SELECT p.price INTO _db_price FROM public.products p WHERE p.id = _product_id;

      INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
      VALUES (_order_id, _product_id, _quantity, _db_price);

      UPDATE public.products
      SET stock_quantity = stock_quantity - _quantity
      WHERE id = _product_id AND stock_quantity IS NOT NULL AND stock_quantity >= _quantity;
    END LOOP;

    -- Insert payment record for online payments (FIXED: correct column names)
    IF _payment_mode IN ('razorpay', 'upi') THEN
      INSERT INTO public.payment_records (
        order_id, buyer_id, seller_id, amount,
        payment_method, payment_status, platform_fee, net_amount,
        payment_collection, payment_mode, society_id
      )
      VALUES (
        _order_id, _buyer_id, _seller_id,
        _total + _delivery_fee - (CASE WHEN _group_count = 1 THEN _discount_amount ELSE 0 END),
        _payment_mode, 'pending', 0,
        _total + _delivery_fee - (CASE WHEN _group_count = 1 THEN _discount_amount ELSE 0 END),
        'direct', 'online', _society_id
      );
    END IF;
  END LOOP;

  RETURN json_build_object('success', true, 'order_ids', array_to_json(_order_ids));
END;
$$;