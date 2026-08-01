
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(_buyer_id uuid, _seller_groups json, _delivery_address text, _notes text, _payment_method text, _payment_status text, _cart_total numeric, _coupon_id text DEFAULT ''::text, _coupon_code text DEFAULT ''::text, _coupon_discount numeric DEFAULT 0, _has_urgent boolean DEFAULT false, _delivery_fee numeric DEFAULT 0, _fulfillment_type text DEFAULT 'delivery'::text, _delivery_address_id uuid DEFAULT NULL::uuid, _delivery_lat double precision DEFAULT NULL::double precision, _delivery_lng double precision DEFAULT NULL::double precision)
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
begin
  -- Security: ensure caller is the buyer
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  select p.society_id, p.name
    into _society_id, _buyer_name
  from public.profiles p
  where p.id = _buyer_id;

  -- Count total groups for fee allocation
  select json_array_length(_seller_groups) into _total_groups;

  -- Pre-validate all sellers
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.business_name,
           public.compute_store_status(
             sp.availability_start,
             sp.availability_end,
             sp.operating_days,
             coalesce(sp.is_available, true)
           ),
           COALESCE(sp.latitude, s.latitude::double precision),
           COALESCE(sp.longitude, s.longitude::double precision),
           sp.delivery_radius_km
      into _seller_name, _seller_status, _seller_lat, _seller_lng, _seller_radius
    from public.seller_profiles sp
    LEFT JOIN public.societies s ON s.id = sp.society_id
    where sp.id = _seller_id;

    if _seller_status is null then
      return json_build_object('success', false, 'error', 'seller_not_found', 'seller_id', _seller_id);
    end if;

    _seller_status_text := coalesce(_seller_status->>'status', 'closed');
    if _seller_status_text <> 'open' then
      _closed_sellers := array_append(_closed_sellers, coalesce(_seller_name, 'Seller'));
    end if;

    -- Delivery radius check
    if _fulfillment_type = 'delivery'
       and _delivery_lat is not null and _delivery_lng is not null
       and _seller_lat is not null and _seller_lng is not null
       and _seller_radius is not null then
      _distance := public.haversine_km(_delivery_lat, _delivery_lng, _seller_lat, _seller_lng);
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range,
          coalesce(_seller_name, 'Seller') || ' (' || round(_distance::numeric, 1) || ' km away, max ' || _seller_radius || ' km)');
      end if;
    end if;
  end loop;

  if array_length(_closed_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'store_closed', 'closed_sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 then
    return json_build_object('success', false, 'error', 'delivery_out_of_range', 'out_of_range_sellers', to_json(_out_of_range));
  end if;

  -- Create orders
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _total := 0;
    _order_id := gen_random_uuid();
    _group_count := _group_count + 1;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _total := _total + ((_item->>'unit_price')::numeric * (_item->>'quantity')::int);
    end loop;

    -- Apply delivery fee to first order only; coupon discount to first order (single-seller) or proportionally
    if _group_count = 1 then
      _order_delivery_fee := _delivery_fee;
      _order_discount := _coupon_discount;
    else
      _order_delivery_fee := 0;
      _order_discount := 0;
    end if;

    -- Adjust total: add delivery fee, subtract coupon discount
    _total := _total + _order_delivery_fee - _order_discount;
    if _total < 0 then _total := 0; end if;

    insert into public.orders (
      id, buyer_id, seller_id, society_id, status, total_amount,
      payment_type, payment_status, delivery_address, notes, order_type, fulfillment_type,
      delivery_address_id, delivery_lat, delivery_lng,
      delivery_fee, discount_amount
    )
    values (
      _order_id, _buyer_id, (_seller_group->>'seller_id')::uuid, _society_id,
      'placed', _total, _payment_method, _payment_status, _delivery_address, _notes,
      'purchase', _fulfillment_type,
      _delivery_address_id, _delivery_lat, _delivery_lng,
      _order_delivery_fee, _order_discount
    );

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
      values (_order_id, (_item->>'product_id')::uuid, _item->>'product_name', (_item->>'quantity')::int, (_item->>'unit_price')::numeric);
    end loop;

    select sp.user_id into _seller_user_id
    from public.seller_profiles sp where sp.id = (_seller_group->>'seller_id')::uuid;

    if _seller_user_id is not null then
      insert into public.notification_queue (user_id, type, title, body, reference_path, payload)
      values (_seller_user_id, 'order', '🆕 New Order Received!',
        coalesce(_buyer_name, 'A buyer') || ' placed an order. Tap to view and accept.',
        '/orders/' || _order_id::text,
        jsonb_build_object('orderId', _order_id::text, 'status', 'placed', 'type', 'order'));
    end if;

    _order_ids := _order_ids || _order_id;
  end loop;

  delete from public.cart_items where user_id = _buyer_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids));
end;
$function$;

-- Also fix compute_store_status for overnight hours
CREATE OR REPLACE FUNCTION public.compute_store_status(p_start time without time zone, p_end time without time zone, p_days text[], p_available boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamp := now();
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

  -- Treat 00:00:00 as end-of-day (23:59:59) so "09:00-00:00" means open until midnight
  v_effective_end := CASE WHEN p_end = '00:00:00' THEN '23:59:59'::time ELSE p_end END;

  -- Detect overnight hours (e.g. 20:00 - 02:00)
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
$function$;
