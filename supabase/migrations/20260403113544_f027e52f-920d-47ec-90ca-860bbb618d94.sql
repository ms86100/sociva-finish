-- Fix 1: Discovery — enforce seller's delivery_radius_km with 10km default
CREATE OR REPLACE FUNCTION public.search_sellers_paginated(
  _lat double precision,
  _lng double precision,
  _radius_km double precision DEFAULT 10,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  seller_id uuid,
  user_id uuid,
  business_name text,
  description text,
  categories text[],
  primary_group text,
  cover_image_url text,
  profile_image_url text,
  is_available boolean,
  is_featured boolean,
  rating numeric,
  total_reviews integer,
  society_name text,
  availability_start text,
  availability_end text,
  seller_latitude double precision,
  seller_longitude double precision,
  operating_days text[],
  distance_km double precision,
  product_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _box_delta double precision;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN; END IF;
  _box_delta := _radius_km * 0.009;

  RETURN QUERY
  SELECT
    sp.id AS seller_id,
    sp.user_id,
    sp.business_name,
    sp.description,
    ARRAY(SELECT unnest(sp.categories)::text) AS categories,
    sp.primary_group::text,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.is_available,
    sp.is_featured,
    sp.rating,
    sp.total_reviews,
    s.name AS society_name,
    sp.availability_start::text,
    sp.availability_end::text,
    COALESCE(sp.latitude, s.latitude::double precision) AS seller_latitude,
    COALESCE(sp.longitude, s.longitude::double precision) AS seller_longitude,
    sp.operating_days::text[] AS operating_days,
    public.haversine_km(_lat, _lng,
      COALESCE(sp.latitude, s.latitude::double precision),
      COALESCE(sp.longitude, s.longitude::double precision)
    ) AS distance_km,
    (SELECT COUNT(*) FROM public.products p
     WHERE p.seller_id = sp.id AND p.is_available = true AND p.approval_status = 'approved'
    ) AS product_count
  FROM public.seller_profiles sp
  LEFT JOIN public.societies s ON s.id = sp.society_id AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
  WHERE sp.verification_status = 'approved'
    AND sp.is_available = true
    AND COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
    AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
    -- Bounding box pre-filter (uses indexes, fast)
    AND COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
    AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
    -- Precise filter: buyer must be within BOTH their search radius AND seller's service radius (default 10km)
    AND public.haversine_km(_lat, _lng,
          COALESCE(sp.latitude, s.latitude::double precision),
          COALESCE(sp.longitude, s.longitude::double precision)
        ) <= LEAST(_radius_km, COALESCE(sp.delivery_radius_km, 10))
  ORDER BY sp.is_featured DESC, distance_km ASC
  LIMIT _limit
  OFFSET _offset;
END;
$$;


-- Fix 2: Order placement — radius check ONLY for delivery, NOT self-pickup
-- + per-seller validation + structured error with distance info + default 10km
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid, _seller_groups json, _delivery_address text DEFAULT ''::text,
  _notes text DEFAULT ''::text, _payment_method text DEFAULT 'cod'::text,
  _payment_status text DEFAULT 'pending'::text, _cart_total numeric DEFAULT 0,
  _coupon_id text DEFAULT ''::text, _coupon_code text DEFAULT ''::text,
  _coupon_discount numeric DEFAULT 0, _has_urgent boolean DEFAULT false,
  _delivery_fee numeric DEFAULT 0, _fulfillment_type text DEFAULT 'self_pickup'::text,
  _delivery_address_id uuid DEFAULT NULL::uuid,
  _delivery_lat double precision DEFAULT NULL::double precision,
  _delivery_lng double precision DEFAULT NULL::double precision,
  _idempotency_key text DEFAULT NULL::text,
  _scheduled_date text DEFAULT NULL::text,
  _scheduled_time_start text DEFAULT NULL::text,
  _preorder_seller_ids uuid[] DEFAULT NULL::uuid[]
)
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
  _effective_radius double precision;
begin
  -- ═══ VALIDATION: auth check ═══
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Idempotency: advisory lock
  if _idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(_buyer_id::text || _idempotency_key));
    select array_agg(id) into _existing_order_ids
    from public.orders
    where buyer_id = _buyer_id and idempotency_key = _idempotency_key;
    if _existing_order_ids is not null and array_length(_existing_order_ids, 1) > 0 then
      return json_build_object('success', true, 'order_ids', to_json(_existing_order_ids), 'deduplicated', true);
    end if;
  end if;

  select full_name into _buyer_name from public.profiles where id = _buyer_id;
  select json_array_length(_seller_groups) into _total_groups;

  -- ═══ PRE-VALIDATION LOOP: check store status + radius (delivery only) ═══
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.business_name,
           CASE
             WHEN sp.manual_pause = true
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

    -- Radius check: ONLY for delivery orders, NOT self-pickup
    -- Self-pickup: buyer travels to seller, no distance restriction needed
    if _fulfillment_type = 'delivery'
       and _delivery_lat is not null and _delivery_lng is not null
       and _seller_lat is not null and _seller_lng is not null then
      _effective_radius := COALESCE(_seller_radius, 10);  -- default 10km
      _distance := 6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_delivery_lat)) * cos(radians(_seller_lat)) *
          cos(radians(_seller_lng) - radians(_delivery_lng)) +
          sin(radians(_delivery_lat)) * sin(radians(_seller_lat))
        ))
      );
      if _distance > _effective_radius then
        _out_of_range := array_append(_out_of_range,
          json_build_object(
            'seller_name', COALESCE(_seller_name, ''),
            'seller_id', _seller_id,
            'distance_km', round(_distance::numeric, 1),
            'allowed_radius_km', round(_effective_radius::numeric, 1)
          )::text
        );
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
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.user_id, sp.society_id, sp.fulfillment_mode, sp.delivery_handled_by
      into _seller_user_id, _society_id, _seller_fulfillment_mode, _delivery_handled_by
    from public.seller_profiles sp where sp.id = _seller_id;

    _group_count := _group_count + 1;

    if _group_count = 1 then
      _order_delivery_fee := _delivery_fee;
      _order_discount := _coupon_discount;
    else
      _order_delivery_fee := 0;
      _order_discount := 0;
    end if;

    -- Resolve coupon
    _resolved_coupon_id := NULL;
    if _coupon_id is not null and _coupon_id <> '' then
      _resolved_coupon_id := _coupon_id::uuid;
    end if;

    -- Row-level idempotency key
    _row_idempotency_key := null;
    if _idempotency_key is not null then
      _row_idempotency_key := _idempotency_key || ':' || _seller_id::text;
    end if;

    -- Determine effective status for scheduled/preorders
    _effective_status := 'placed';
    _effective_scheduled_date := NULLIF(_scheduled_date, '')::date;
    _effective_scheduled_time := NULLIF(_scheduled_time_start, '')::time;

    if _preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids) then
      _effective_status := 'scheduled';
    end if;

    -- Insert order
    insert into public.orders (
      buyer_id, seller_id, total_amount, status,
      delivery_address, notes, payment_method, payment_status,
      transaction_type, fulfillment_type, delivery_address_id,
      delivery_lat, delivery_lng,
      delivery_fee, coupon_id, coupon_code, coupon_discount,
      has_urgent, society_id, auto_cancel_at,
      idempotency_key, scheduled_date, scheduled_time_start,
      fulfillment_mode, delivery_handled_by
    ) values (
      _buyer_id, _seller_id, 0, _effective_status,
      _delivery_address, _notes, _payment_method, _payment_status,
      'purchase', _fulfillment_type, _delivery_address_id,
      _delivery_lat, _delivery_lng,
      _order_delivery_fee, _resolved_coupon_id, NULLIF(_coupon_code, ''), _order_discount,
      _has_urgent, _society_id, _auto_cancel_at,
      _row_idempotency_key, _effective_scheduled_date, _effective_scheduled_time,
      _seller_fulfillment_mode, _delivery_handled_by
    )
    on conflict (buyer_id, idempotency_key) do nothing
    returning id into _order_id;

    -- If conflict (duplicate), find existing
    if _order_id is null and _row_idempotency_key is not null then
      select id into _found_existing_id from public.orders
      where buyer_id = _buyer_id and idempotency_key = _row_idempotency_key;
      _order_ids := array_append(_order_ids, _found_existing_id);
      continue;
    end if;

    if _group_count = 1 then
      _first_order_id := _order_id;
    end if;

    -- Insert order items with server-verified prices
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
      _client_price := COALESCE((_item->>'price')::numeric, 0);
      _client_qty := COALESCE((_item->>'quantity')::int, 1);

      select * into _product_row from public.products where id = _product_id for update;

      if _product_row is null or _product_row.is_available = false or _product_row.approval_status <> 'approved' then
        _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text));
        continue;
      end if;

      _server_price := _product_row.price;
      _product_name_val := _product_row.name;

      if _server_price <> _client_price then
        _price_changed_items := array_append(_price_changed_items,
          _product_name_val || ': ₹' || _client_price || ' → ₹' || _server_price);
      end if;

      -- Stock check
      if _product_row.stock_quantity is not null and _product_row.stock_quantity < _client_qty then
        _stock_insufficient := array_append(_stock_insufficient,
          _product_name_val || ' (available: ' || _product_row.stock_quantity || ')');
        continue;
      end if;

      insert into public.order_items (order_id, product_id, quantity, price, product_name)
      values (_order_id, _product_id, _client_qty, _server_price, _product_name_val);

      _total := _total + (_server_price * _client_qty);
    end loop;

    -- Update order total
    update public.orders set total_amount = _total where id = _order_id;
    _order_ids := array_append(_order_ids, _order_id);

    -- Coupon redemption for first order
    if _group_count = 1 and _resolved_coupon_id is not null then
      insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied)
      values (_resolved_coupon_id, _order_id, _buyer_id, _coupon_discount);

      update public.coupons set times_used = times_used + 1 where id = _resolved_coupon_id;
    end if;

    -- Clear cart for this seller
    if _fulfillment_type = 'delivery' then
      delete from public.cart_items
      where user_id = _buyer_id
        and product_id in (select (j->>'product_id')::uuid from json_array_elements(_seller_group->'items') j)
        and society_id is not distinct from _society_id;
    else
      delete from public.cart_items
      where user_id = _buyer_id
        and product_id in (select (j->>'product_id')::uuid from json_array_elements(_seller_group->'items') j);
    end if;
  end loop;

  -- Return validation errors if any
  if array_length(_unavailable_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'unavailable_items', 'items', to_json(_unavailable_items));
  end if;

  if array_length(_stock_insufficient, 1) > 0 then
    return json_build_object('success', false, 'error', 'insufficient_stock', 'items', to_json(_stock_insufficient));
  end if;

  return json_build_object(
    'success', true,
    'order_ids', to_json(_order_ids),
    'price_changes', case when array_length(_price_changed_items, 1) > 0 then to_json(_price_changed_items) else null end
  );
end;
$function$;
