
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
  _effective_scheduled_date date;
  _effective_scheduled_time time;
  _product_id uuid;
  _product_row record;
  _product_name_val text;
  _server_price numeric;
  _client_price numeric;
  _client_qty int;
  _unavailable_items text[] := '{}';
  _price_changed_items text[] := '{}';
  _stock_insufficient text[] := '{}';
begin
  -- Enforce buyer = authenticated user
  if auth.uid() is distinct from _buyer_id then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Resolve society
  select society_id into _society_id from public.profiles where id = _buyer_id;

  -- Advisory lock for idempotency
  if _idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(_idempotency_key));
    select array_agg(id) into _existing_order_ids
    from public.orders
    where buyer_id = _buyer_id and idempotency_key like _idempotency_key || ':%';
    if _existing_order_ids is not null and array_length(_existing_order_ids, 1) > 0 then
      return json_build_object('success', true, 'order_ids', to_json(_existing_order_ids), 'order_count', array_length(_existing_order_ids, 1), 'deduplicated', true);
    end if;
  end if;

  -- Resolve buyer name
  select name into _buyer_name from public.profiles where id = _buyer_id;

  -- Resolve coupon
  if _coupon_id is not null and _coupon_id <> '' then
    _resolved_coupon_id := _coupon_id::uuid;
  else
    _resolved_coupon_id := null;
  end if;

  -- Determine effective status
  if _payment_method <> 'cod' then
    _effective_status := 'payment_pending';
  else
    _effective_status := 'placed';
  end if;

  -- ═══ PRODUCT VALIDATION (price, availability, stock) ═══
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _client_price := (_item->>'unit_price')::numeric;
      _client_qty := (_item->>'quantity')::int;
      _seller_id := (_seller_group->>'seller_id')::uuid;

      select p.id, p.name, p.price, p.is_available, p.approval_status, p.stock_quantity, p.seller_id
        into _product_row
        from public.products p
        where p.id = _product_id
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
        _price_changed_items := array_append(_price_changed_items, 
          COALESCE(_product_row.name, '') || ': ' || _client_price || ' → ' || _product_row.price);
      end if;

      if _product_row.stock_quantity is not null and _product_row.stock_quantity < _client_qty then
        _stock_insufficient := array_append(_stock_insufficient, 
          COALESCE(_product_row.name, '') || ' (only ' || COALESCE(_product_row.stock_quantity, 0) || ' left)');
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

  -- ═══ SELLER VALIDATION (store open, delivery range) ═══
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.business_name,
           CASE
             WHEN sp.manual_override = 'open' AND (sp.manual_override_until IS NULL OR now() <= sp.manual_override_until)
               THEN '{"status":"open","next_open_at":null,"minutes_until_open":0}'::jsonb
             WHEN sp.manual_override = 'closed' AND (sp.manual_override_until IS NULL OR now() <= sp.manual_override_until)
               THEN '{"status":"paused","next_open_at":null,"minutes_until_open":null}'::jsonb
             ELSE public.compute_store_status(sp.availability_start, sp.availability_end, sp.operating_days, sp.is_available)
           END,
           sp.latitude, sp.longitude, sp.delivery_radius_km
      into _seller_name, _seller_status, _seller_lat, _seller_lng, _seller_radius
    from public.seller_profiles sp where sp.id = _seller_id;

    _seller_status_text := _seller_status->>'status';

    if _seller_status_text in ('closed', 'closed_today', 'paused') then
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
    _auto_cancel_at := now() + interval '30 minutes';
  else
    _auto_cancel_at := NULL;
  end if;

  -- ═══ ORDER CREATION (server-verified prices + product_name snapshot) ═══
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

    -- Pre-calculate total from server prices
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      select price into _server_price from public.products where id = _product_id;
      _total := _total + (_server_price * (_item->>'quantity')::int);
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

    -- Only apply scheduling to pre-order sellers; cast safely
    if _preorder_seller_ids is null or _seller_id = ANY(_preorder_seller_ids) then
      _effective_scheduled_date := NULLIF(_scheduled_date, '')::date;
      _effective_scheduled_time := NULLIF(_scheduled_time_start, '')::time;
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
      _effective_scheduled_date, _effective_scheduled_time
    )
    on conflict (buyer_id, idempotency_key) where idempotency_key is not null
    do update set id = orders.id
    returning id into _order_id;

    _order_ids := array_append(_order_ids, _order_id);

    -- Insert order_items WITH product_name from authoritative product data
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      select name, price into _product_name_val, _server_price
        from public.products where id = _product_id;

      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
      values (
        _order_id,
        _product_id,
        COALESCE(_product_name_val, 'Unknown Product'),
        (_item->>'quantity')::int,
        _server_price
      );

      update public.products
      set stock_quantity = stock_quantity - (_item->>'quantity')::int
      where id = _product_id
        and stock_quantity is not null
        and stock_quantity >= (_item->>'quantity')::int;
    end loop;

    -- Insert payment record for online payments
    IF _payment_method <> 'cod' AND _payment_status = 'pending' THEN
      INSERT INTO public.payment_records (
        order_id, buyer_id, seller_id, amount,
        payment_method, payment_status, platform_fee, net_amount,
        payment_collection, payment_mode, society_id
      ) VALUES (
        _order_id, _buyer_id, _seller_id, _total,
        'online', 'pending', 0, _total,
        'direct', 'online', _society_id
      );
    END IF;
  end loop;

  -- Coupon redemption
  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied)
    values (_resolved_coupon_id, _first_order_id, _buyer_id, _coupon_discount);

    update public.coupons set times_used = times_used + 1 where id = _resolved_coupon_id;
  end if;

  -- P0 FIX: Only clear cart for COD (immediate confirmation).
  -- For online payments (payment_pending), cart is preserved until payment is confirmed client-side.
  IF _payment_method = 'cod' THEN
    DELETE FROM public.cart_items WHERE user_id = _buyer_id AND society_id IS NOT DISTINCT FROM _society_id;
  END IF;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids), 'order_count', array_length(_order_ids, 1));
end;
$function$;
