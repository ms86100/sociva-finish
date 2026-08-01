
-- Fix 1: Settlement trigger — also fire on 'completed' (for self-pickup orders)
CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _gross numeric;
  _fee_pct numeric;
  _platform_fee numeric;
BEGIN
  IF NEW.status IN ('delivered', 'completed') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    _gross := COALESCE(NEW.total_amount, 0);
    
    SELECT COALESCE(NULLIF(value, '')::numeric, 0) INTO _fee_pct
    FROM public.system_settings WHERE key = 'platform_fee_percent';
    
    IF _fee_pct IS NULL THEN _fee_pct := 0; END IF;
    
    _platform_fee := ROUND(_gross * _fee_pct / 100, 2);
    
    INSERT INTO public.payment_settlements (seller_id, order_id, gross_amount, platform_fee, net_amount, settlement_status)
    VALUES (NEW.seller_id, NEW.id, _gross, _platform_fee, _gross - _platform_fee, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- Fix 2: Coupon redemption tracking in create_multi_vendor_orders
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
  _resolved_coupon_id uuid;
  _first_order_id uuid;
begin
  -- Security: ensure caller is the buyer
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- Resolve coupon_id once
  _resolved_coupon_id := NULLIF(_coupon_id, '')::uuid;

  select p.society_id, p.name
    into _society_id, _buyer_name
  from public.profiles p
  where p.id = _buyer_id;

  select json_array_length(_seller_groups) into _total_groups;

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

  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _total := 0;
    _order_id := gen_random_uuid();
    _group_count := _group_count + 1;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _total := _total + ((_item->>'unit_price')::numeric * (_item->>'quantity')::int);
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

    insert into public.orders (
      id, buyer_id, seller_id, society_id, status, total_amount,
      payment_type, payment_status, delivery_address, notes, order_type, fulfillment_type,
      delivery_address_id, delivery_lat, delivery_lng,
      delivery_fee, discount_amount, coupon_id
    )
    values (
      _order_id, _buyer_id, (_seller_group->>'seller_id')::uuid, _society_id,
      'placed', _total, _payment_method, _payment_status, _delivery_address, _notes,
      'purchase', _fulfillment_type,
      _delivery_address_id, _delivery_lat, _delivery_lng,
      _order_delivery_fee, _order_discount,
      CASE WHEN _group_count = 1 THEN _resolved_coupon_id ELSE NULL END
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

  -- Record coupon redemption and increment usage counter
  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied)
    values (_resolved_coupon_id, _first_order_id, _buyer_id, _coupon_discount);

    update public.coupons set times_used = times_used + 1 where id = _resolved_coupon_id;
  end if;

  delete from public.cart_items where user_id = _buyer_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids));
end;
$function$;
