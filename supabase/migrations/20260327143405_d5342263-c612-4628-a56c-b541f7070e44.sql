
-- Fix: cast text scheduled_date/scheduled_time_start to proper types in create_multi_vendor_orders
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _society_id uuid,
  _seller_groups json,
  _payment_mode text DEFAULT 'cod',
  _delivery_address_id uuid DEFAULT NULL,
  _delivery_lat double precision DEFAULT NULL,
  _delivery_lng double precision DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _scheduled_date text DEFAULT NULL,
  _scheduled_time_start text DEFAULT NULL,
  _preorder_seller_ids uuid[] DEFAULT NULL
)
RETURNS json
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
begin
  -- Auth check
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'auth_mismatch', 'message', 'Buyer ID does not match authenticated user');
  end if;

  _group_count := json_array_length(_seller_groups);

  -- First pass: validate all sellers (store open, delivery range)
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.business_name,
           public.compute_store_status(sp.availability_start, sp.availability_end, sp.manual_override, sp.manual_override_until),
           sp.latitude, sp.longitude, sp.delivery_radius_km
      into _seller_name, _seller_status, _seller_lat, _seller_lng, _seller_radius
    from public.seller_profiles sp where sp.id = _seller_id;

    _seller_status_text := _seller_status->>'status';

    if _seller_status_text = 'closed' then
      _closed_sellers := array_append(_closed_sellers, COALESCE(_seller_name, _seller_id::text));
    end if;

    -- Check delivery range if coordinates provided
    if _delivery_lat is not null and _delivery_lng is not null and _seller_lat is not null and _seller_lng is not null then
      _distance_km := 6371 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(_delivery_lat)) * cos(radians(_seller_lat)) *
          cos(radians(_seller_lng) - radians(_delivery_lng)) +
          sin(radians(_delivery_lat)) * sin(radians(_seller_lat))
        ))
      );
      if _seller_radius is not null and _seller_radius > 0 and _distance_km > _seller_radius then
        _out_of_range_sellers := array_append(_out_of_range_sellers, COALESCE(_seller_name, _seller_id::text));
      end if;
    end if;

    -- Second pass: validate all items
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _quantity := (_item->>'quantity')::int;
      _client_price := (_item->>'unit_price')::numeric;

      select p.price, p.stock_quantity, p.is_available, p.is_approved, p.seller_id
        into _db_price, _db_stock, _db_available, _db_approved, _db_seller_id
      from public.products p where p.id = _product_id for update;

      if _db_price is null then
        _unavailable_items := array_append(_unavailable_items, _product_id::text);
        continue;
      end if;

      if _db_available = false or _db_approved = false then
        _unavailable_items := array_append(_unavailable_items, _product_id::text);
        continue;
      end if;

      if _db_seller_id != _seller_id then
        _unavailable_items := array_append(_unavailable_items, _product_id::text);
        continue;
      end if;

      if abs(_db_price - _client_price) > 0.01 then
        _price_changed_items := array_append(_price_changed_items, _product_id::text);
      end if;

      if _db_stock is not null and _db_stock >= 0 and _db_stock < _quantity then
        _stock_issues := array_append(_stock_issues, _product_id::text || ':' || _db_stock::text);
      end if;
    end loop;
  end loop;

  -- Return validation errors
  if array_length(_closed_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'store_closed', 'sellers', _closed_sellers);
  end if;
  if array_length(_out_of_range_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'delivery_out_of_range', 'sellers', _out_of_range_sellers);
  end if;
  if array_length(_unavailable_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'unavailable_items', 'items', _unavailable_items);
  end if;
  if array_length(_price_changed_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'price_changed', 'items', _price_changed_items);
  end if;
  if array_length(_stock_issues, 1) > 0 then
    return json_build_object('success', false, 'error', 'insufficient_stock', 'items', _stock_issues);
  end if;

  -- All validations passed — create orders
  _effective_status := case when _payment_mode in ('razorpay', 'upi') then 'payment_pending' else 'placed' end;

  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;
    _delivery_fee := coalesce((_seller_group->>'delivery_fee')::numeric, 0);
    _discount_amount := coalesce((_seller_group->>'discount_amount')::numeric, 0);
    _resolved_coupon_id := (_seller_group->>'coupon_id')::uuid;
    _delivery_handled_by := coalesce(_seller_group->>'delivery_handled_by', 'seller');
    _transaction_type := coalesce(_seller_group->>'transaction_type', 'delivery');

    _total := 0;
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _quantity := (_item->>'quantity')::int;

      select p.price into _db_price from public.products p where p.id = _product_id;
      _total := _total + (_db_price * _quantity);
    end loop;

    _order_id := gen_random_uuid();
    _order_ids := array_append(_order_ids, _order_id);

    if _idempotency_key is not null then
      _row_idempotency_key := _idempotency_key || '::' || _seller_id::text;
    else
      _row_idempotency_key := null;
    end if;

    _auto_cancel_at := case when _effective_status = 'payment_pending' then now() + interval '30 minutes' else null end;

    -- Only apply scheduled_date to pre-order sellers
    if _preorder_seller_ids is null or _seller_id = ANY(_preorder_seller_ids) then
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;

    insert into public.orders (
      id, buyer_id, seller_id, society_id, status,
      total_amount, payment_mode, delivery_address_id,
      delivery_fee, discount_amount, coupon_id,
      delivery_handled_by, idempotency_key, auto_cancel_at,
      scheduled_date, scheduled_time_start, transaction_type
    )
    values (
      _order_id, _buyer_id, _seller_id, _society_id, _effective_status,
      _total, _payment_mode, _delivery_address_id,
      _delivery_fee,
      CASE WHEN _group_count = 1 THEN _discount_amount ELSE 0 END,
      CASE WHEN _group_count = 1 THEN _resolved_coupon_id ELSE NULL END,
      _delivery_handled_by, _row_idempotency_key, _auto_cancel_at,
      _effective_scheduled_date::date, _effective_scheduled_time::time,
      _transaction_type
    )
    on conflict (buyer_id, idempotency_key) where idempotency_key is not null
    do update set updated_at = now()
    returning id into _order_id;

    -- Insert order items
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _quantity := (_item->>'quantity')::int;

      select p.price into _db_price from public.products p where p.id = _product_id;

      insert into public.order_items (order_id, product_id, quantity, unit_price)
      values (_order_id, _product_id, _quantity, _db_price);

      -- Decrement stock
      update public.products
      set stock_quantity = stock_quantity - _quantity
      where id = _product_id and stock_quantity is not null and stock_quantity >= _quantity;
    end loop;

    -- Insert payment record for online payments
    if _payment_mode in ('razorpay', 'upi') then
      insert into public.payment_records (order_id, amount, method, status)
      values (_order_id, _total + _delivery_fee - (CASE WHEN _group_count = 1 THEN _discount_amount ELSE 0 END), _payment_mode, 'pending');
    end if;
  end loop;

  return json_build_object('success', true, 'order_ids', array_to_json(_order_ids));
end;
$$;
