
-- ============================================================
-- Blocker 1: compute_store_status 4-arg overload (time,time,text[],boolean)
-- Required by validate_cart_item_store_availability trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_store_status(
  p_start time without time zone,
  p_end time without time zone,
  p_days text[],
  p_available boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_current_time time := v_now::time;
  v_current_day text := to_char(v_now, 'Dy');
  v_next_open timestamptz;
  v_minutes_until int;
  v_effective_end time;
  v_is_overnight boolean;
  v_is_open boolean;
BEGIN
  IF p_available = false THEN
    RETURN jsonb_build_object('status', 'paused', 'next_open_at', null, 'minutes_until_open', null);
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  END IF;
  IF p_days IS NOT NULL AND array_length(p_days, 1) > 0 AND NOT (v_current_day = ANY(p_days)) THEN
    RETURN jsonb_build_object('status', 'closed_today', 'next_open_at', null, 'minutes_until_open', null);
  END IF;
  v_effective_end := CASE WHEN p_end = '00:00:00' THEN '23:59:59'::time ELSE p_end END;
  v_is_overnight := v_effective_end <= p_start;
  IF v_is_overnight THEN
    v_is_open := v_current_time >= p_start OR v_current_time < v_effective_end;
  ELSE
    v_is_open := v_current_time >= p_start AND v_current_time < v_effective_end;
  END IF;
  IF v_is_open THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  ELSE
    IF v_current_time < p_start THEN
      v_minutes_until := EXTRACT(EPOCH FROM (p_start - v_current_time))::int / 60;
      v_next_open := date_trunc('day', v_now) + p_start;
    ELSE
      v_next_open := date_trunc('day', v_now) + interval '1 day' + p_start;
      v_minutes_until := EXTRACT(EPOCH FROM (v_next_open - v_now))::int / 60;
    END IF;
    RETURN jsonb_build_object('status', 'closed', 'next_open_at', v_next_open, 'minutes_until_open', v_minutes_until);
  END IF;
END;
$$;

-- ============================================================
-- compute_store_status overload (time,time,text,timestamptz)
-- Used by create_multi_vendor_orders for manual override checks
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_store_status(
  p_start time without time zone,
  p_end time without time zone,
  p_manual_override text,
  p_manual_override_until timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_now timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_current_time time := v_now::time;
  v_next_open timestamptz;
  v_minutes_until int;
  v_effective_end time;
  v_is_overnight boolean;
  v_is_open boolean;
BEGIN
  IF p_manual_override IS NOT NULL AND p_manual_override != '' THEN
    IF p_manual_override_until IS NOT NULL AND now() > p_manual_override_until THEN
      NULL;
    ELSIF p_manual_override = 'open' THEN
      RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
    ELSIF p_manual_override = 'closed' THEN
      RETURN jsonb_build_object('status', 'paused', 'next_open_at', null, 'minutes_until_open', null);
    END IF;
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  END IF;
  v_effective_end := CASE WHEN p_end = '00:00:00' THEN '23:59:59'::time ELSE p_end END;
  v_is_overnight := v_effective_end <= p_start;
  IF v_is_overnight THEN
    v_is_open := v_current_time >= p_start OR v_current_time < v_effective_end;
  ELSE
    v_is_open := v_current_time >= p_start AND v_current_time < v_effective_end;
  END IF;
  IF v_is_open THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  ELSE
    IF v_current_time < p_start THEN
      v_minutes_until := EXTRACT(EPOCH FROM (p_start - v_current_time))::int / 60;
      v_next_open := date_trunc('day', v_now) + p_start;
    ELSE
      v_next_open := date_trunc('day', v_now) + interval '1 day' + p_start;
      v_minutes_until := EXTRACT(EPOCH FROM (v_next_open - v_now))::int / 60;
    END IF;
    RETURN jsonb_build_object('status', 'closed', 'next_open_at', v_next_open, 'minutes_until_open', v_minutes_until);
  END IF;
END;
$$;

-- ============================================================
-- Blocker 2: validate_order_fulfillment_type — accept booking types
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_order_fulfillment_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.fulfillment_type IS NOT NULL AND NEW.fulfillment_type NOT IN (
    'self_pickup', 'delivery', 'seller_delivery', 'digital',
    'at_seller', 'at_buyer', 'home_visit', 'online'
  ) THEN
    RAISE EXCEPTION 'Invalid fulfillment_type';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- Blocker 3: Add missing order_status enum values
-- ============================================================
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'buyer_received';

-- ============================================================
-- Blocker 4: get_society_order_stats geo-aware 5-arg overload
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_society_order_stats(
  _product_ids uuid[],
  _society_id uuid DEFAULT NULL::uuid,
  _lat double precision DEFAULT NULL::double precision,
  _lng double precision DEFAULT NULL::double precision,
  _radius_km double precision DEFAULT 5
) RETURNS TABLE(product_id uuid, families_this_week bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _box_delta double precision;
BEGIN
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    _box_delta := _radius_km * 0.009;
    RETURN QUERY
    SELECT oi.product_id, COUNT(DISTINCT o.buyer_id)::bigint AS families_this_week
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.delivery_addresses da ON da.user_id = o.buyer_id AND da.is_default = true
    WHERE oi.product_id = ANY(_product_ids)
      AND o.status NOT IN ('cancelled')
      AND o.created_at > now() - interval '7 days'
      AND da.latitude IS NOT NULL AND da.longitude IS NOT NULL
      AND da.latitude BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
      AND da.longitude BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
      AND public.haversine_km(_lat, _lng, da.latitude, da.longitude) <= _radius_km
    GROUP BY oi.product_id;
  ELSIF _society_id IS NOT NULL THEN
    RETURN QUERY
    SELECT oi.product_id, COUNT(DISTINCT o.buyer_id)::bigint AS families_this_week
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.profiles p ON p.id = o.buyer_id
    WHERE oi.product_id = ANY(_product_ids)
      AND p.society_id = _society_id
      AND o.status NOT IN ('cancelled')
      AND o.created_at > now() - interval '7 days'
    GROUP BY oi.product_id;
  END IF;
END;
$$;

-- ============================================================
-- Blocker 5: create_multi_vendor_orders — new overload matching frontend
-- (keeps the old 17-arg overload intact for backward compatibility)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _seller_groups json,
  _delivery_address text DEFAULT ''::text,
  _notes text DEFAULT ''::text,
  _payment_method text DEFAULT 'cod'::text,
  _payment_status text DEFAULT 'pending'::text,
  _cart_total numeric DEFAULT 0,
  _coupon_id text DEFAULT ''::text,
  _coupon_code text DEFAULT ''::text,
  _coupon_discount numeric DEFAULT 0,
  _has_urgent boolean DEFAULT false,
  _delivery_fee numeric DEFAULT 0,
  _fulfillment_type text DEFAULT 'self_pickup'::text,
  _delivery_address_id uuid DEFAULT NULL::uuid,
  _delivery_lat double precision DEFAULT NULL::double precision,
  _delivery_lng double precision DEFAULT NULL::double precision,
  _idempotency_key text DEFAULT NULL::text,
  _scheduled_date text DEFAULT NULL::text,
  _scheduled_time_start text DEFAULT NULL::text,
  _preorder_seller_ids uuid[] DEFAULT NULL::uuid[]
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  _payment_blocked_sellers text[] := '{}';
  _seller_payment_config jsonb;
  _config_accepts_cod boolean;
  _config_accepts_online boolean;
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

  -- Validation pass: products, prices, stock, payment config
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

  -- Second pass: store status, distance, payment method validation
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

    if _fulfillment_type = 'self_pickup' then
      select sp.pickup_payment_config into _seller_payment_config
      from public.seller_profiles sp where sp.id = _seller_id;
    else
      select sp.delivery_payment_config into _seller_payment_config
      from public.seller_profiles sp where sp.id = _seller_id;
    end if;

    if _seller_payment_config is not null then
      _config_accepts_cod := COALESCE((_seller_payment_config->>'accepts_cod')::boolean, true);
      _config_accepts_online := COALESCE((_seller_payment_config->>'accepts_online')::boolean, true);

      if _payment_method = 'cod' and not _config_accepts_cod then
        _payment_blocked_sellers := array_append(_payment_blocked_sellers, COALESCE(_seller_name, _seller_id::text) || ' (cash not accepted)');
      elsif _payment_method <> 'cod' and not _config_accepts_online then
        _payment_blocked_sellers := array_append(_payment_blocked_sellers, COALESCE(_seller_name, _seller_id::text) || ' (online payment not accepted)');
      end if;
    end if;
  end loop;

  if array_length(_closed_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'store_closed', 'closed_sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 then
    return json_build_object('success', false, 'error', 'delivery_out_of_range', 'out_of_range_sellers', to_json(_out_of_range));
  end if;

  if array_length(_payment_blocked_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'payment_method_not_allowed', 'blocked_sellers', to_json(_payment_blocked_sellers));
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

  delete from public.cart_items where user_id = _buyer_id and society_id IS NOT DISTINCT FROM _society_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids), 'order_count', array_length(_order_ids, 1));
end;
$$;
