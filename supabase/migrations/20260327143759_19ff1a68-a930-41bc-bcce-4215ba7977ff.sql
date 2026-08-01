CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(_buyer_id uuid, _seller_groups json, _delivery_address text DEFAULT ''::text, _notes text DEFAULT ''::text, _payment_method text DEFAULT 'cod'::text, _payment_status text DEFAULT 'pending'::text, _cart_total numeric DEFAULT 0, _coupon_id text DEFAULT ''::text, _coupon_code text DEFAULT ''::text, _coupon_discount numeric DEFAULT 0, _has_urgent boolean DEFAULT false, _delivery_fee numeric DEFAULT 0, _fulfillment_type text DEFAULT 'self_pickup'::text, _delivery_address_id uuid DEFAULT NULL::uuid, _delivery_lat double precision DEFAULT NULL::double precision, _delivery_lng double precision DEFAULT NULL::double precision, _idempotency_key text DEFAULT NULL::text, _scheduled_date text DEFAULT NULL::text, _scheduled_time_start text DEFAULT NULL::text, _preorder_seller_ids uuid[] DEFAULT NULL::uuid[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _seller_group json;
  _order_id uuid;
  _order_ids uuid[] := '{}';
  _item json;
  _society_id uuid;
  _total numeric;
  _seller_user_id uuid;
  _buyer_name text;
  _seller_id uuid;
  _seller_name text;
  _seller_status jsonb;
  _seller_status_text text;
  _closed_sellers text[] := '{}';
  _seller_lat double precision;
  _seller_lng double precision;
  _seller_radius double precision;
  _distance double precision;
  _out_of_range text[] := '{}';
  _group_count int := 0;
  _total_groups int;
  _order_delivery_fee numeric;
  _order_discount numeric;
  _resolved_coupon_id uuid;
  _first_order_id uuid;
  _seller_fulfillment_mode text;
  _delivery_handled_by text;
  _existing_order_ids uuid[];
  _row_idempotency_key text;
  _found_existing_id uuid;
  _auto_cancel_at timestamptz;
  _effective_status text;
  _effective_scheduled_date text;
  _effective_scheduled_time text;
  _product_id uuid;
  _product_row record;
  _client_price numeric;
  _client_qty int;
  _unavailable_items text[] := '{}';
  _price_changed_items text[] := '{}';
  _stock_insufficient text[] := '{}';
begin
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  if _payment_status = 'pending' and _payment_method <> 'cod' then
    _effective_status := 'payment_pending';
  else
    _effective_status := 'placed';
  end if;

  if _idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(_idempotency_key));
  end if;

  if _idempotency_key is not null then
    select array_agg(o.id order by o.created_at, o.id)
      into _existing_order_ids
    from public.orders o
    where o.buyer_id = _buyer_id
      and o.idempotency_key like _idempotency_key || ':%';

    if _existing_order_ids is not null and array_length(_existing_order_ids, 1) > 0 then
      return json_build_object('success', true, 'order_ids', to_json(_existing_order_ids), 'deduplicated', true);
    end if;
  end if;

  _resolved_coupon_id := NULLIF(_coupon_id, '')::uuid;

  select p.society_id, p.name into _society_id, _buyer_name
  from public.profiles p where p.id = _buyer_id;

  select json_array_length(_seller_groups) into _total_groups;

  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _client_price := (_item->>'unit_price')::numeric;
      _client_qty := (_item->>'quantity')::int;

      select id, name, price, is_available, approval_status, seller_id, stock_quantity
        into _product_row
        from public.products
        where id = _product_id
        for update;

      if _product_row is null then
        _unavailable_items := array_append(_unavailable_items, COALESCE((_item->>'product_name')::text, _product_id::text));
        continue;
      end if;

      if not _product_row.is_available or _product_row.approval_status <> 'approved' then
        _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text));
        continue;
      end if;

      if _product_row.seller_id <> _seller_id then
        _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text) || ' (seller mismatch)');
        continue;
      end if;

      if abs(_product_row.price - _client_price) > 0.01 then
        _price_changed_items := array_append(_price_changed_items, COALESCE(_product_row.name, '') || ': ' || _client_price || ' → ' || _product_row.price);
      end if;

      if _product_row.stock_quantity is not null and _product_row.stock_quantity < _client_qty then
        _stock_insufficient := array_append(_stock_insufficient, COALESCE(_product_row.name, '') || ' (only ' || COALESCE(_product_row.stock_quantity, 0) || ' left)');
      end if;
    end loop;
  end loop;

  if array_length(_unavailable_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'unavailable_items', 'unavailable_items', to_json(_unavailable_items));
  end if;

  if array_length(_price_changed_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'price_changed', 'price_changed_items', to_json(_price_changed_items));
  end if;

  if array_length(_stock_insufficient, 1) > 0 then
    return json_build_object('success', false, 'error', 'insufficient_stock', 'stock_insufficient', to_json(_stock_insufficient));
  end if;

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

    if _fulfillment_type = 'delivery' and _delivery_lat is not null and _delivery_lng is not null
       and _seller_lat is not null and _seller_lng is not null and _seller_radius is not null then
      _distance := 6371 * acos(
        cos(radians(_delivery_lat)) * cos(radians(_seller_lat)) *
        cos(radians(_seller_lng) - radians(_delivery_lng)) +
        sin(radians(_delivery_lat)) * sin(radians(_seller_lat))
      );
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, '') || ' (max ' || round(_seller_radius::numeric, 1) || ' km)');
      end if;
    end if;
  end loop;

  if array_length(_closed_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'store_closed', 'closed_sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 then
    return json_build_object('success', false, 'error', 'delivery_out_of_range', 'out_of_range_sellers', to_json(_out_of_range));
  end if;

  if _payment_method <> 'cod' then
    _auto_cancel_at := now() + interval '3 minutes';
  else
    _auto_cancel_at := NULL;
  end if;

  _group_count := 0;
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _total := 0;
    _order_id := gen_random_uuid();
    _group_count := _group_count + 1;
    _seller_id := (_seller_group->>'seller_id')::uuid;
    _row_idempotency_key := case
      when _idempotency_key is null then null
      else _idempotency_key || ':' || _seller_id::text
    end;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      select price into _client_price from public.products where id = _product_id;
      _total := _total + (_client_price * (_item->>'quantity')::int);
    end loop;

    if _group_count = 1 then
      _order_delivery_fee := _delivery_fee;
      _order_discount := _coupon_discount;
      _first_order_id := _order_id;
    else
      _order_delivery_fee := 0;
      _order_discount := 0;
    end if;

    _total := _total + _order_delivery_fee - _order_discount;
    if _total < 0 then _total := 0; end if;

    _delivery_handled_by := NULL;
    if _fulfillment_type = 'delivery' then
      select sp.fulfillment_mode into _seller_fulfillment_mode
      from public.seller_profiles sp where sp.id = _seller_id;

      if _seller_fulfillment_mode in ('seller_delivery', 'pickup_and_seller_delivery') then
        _delivery_handled_by := 'seller';
      elsif _seller_fulfillment_mode in ('platform_delivery', 'pickup_and_platform_delivery') then
        _delivery_handled_by := 'platform';
      else
        _delivery_handled_by := 'seller';
      end if;
    end if;

    if _preorder_seller_ids is null or _seller_id = ANY(_preorder_seller_ids) then
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;

    insert into public.orders (
      id, buyer_id, seller_id, society_id, status, total_amount,
      payment_type, payment_status, delivery_address, notes,
      order_type, fulfillment_type, delivery_address_id,
      delivery_lat, delivery_lng,
      delivery_fee, discount_amount, coupon_id,
      delivery_handled_by, idempotency_key, auto_cancel_at,
      scheduled_date, scheduled_time_start
    )
    values (
      _order_id, _buyer_id, _seller_id, _society_id, _effective_status::order_status, _total,
      _payment_method, _payment_status, _delivery_address, _notes,
      'purchase', _fulfillment_type, _delivery_address_id,
      _delivery_lat, _delivery_lng,
      _order_delivery_fee, _order_discount,
      CASE WHEN _group_count = 1 THEN _resolved_coupon_id ELSE NULL END,
      _delivery_handled_by, _row_idempotency_key, _auto_cancel_at,
      NULLIF(_effective_scheduled_date, '')::date, NULLIF(_effective_scheduled_time, '')::time
    )
    on conflict (buyer_id, idempotency_key) where idempotency_key is not null
    do update set id = orders.id
    returning id into _order_id;

    _order_ids := array_append(_order_ids, _order_id);

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      select price into _client_price from public.products where id = _product_id;
      insert into public.order_items (order_id, product_id, quantity, unit_price)
      values (_order_id, _product_id, (_item->>'quantity')::int, _client_price);

      update public.products
      set stock_quantity = stock_quantity - (_item->>'quantity')::int
      where id = _product_id
        and stock_quantity is not null
        and stock_quantity >= (_item->>'quantity')::int;
    end loop;
  end loop;

  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied)
    values (_resolved_coupon_id, _first_order_id, _buyer_id, _coupon_discount);

    update public.coupons set times_used = times_used + 1 where id = _resolved_coupon_id;
  end if;

  delete from public.cart_items where user_id = _buyer_id and society_id = _society_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids), 'order_count', array_length(_order_ids, 1));
end;
$function$;