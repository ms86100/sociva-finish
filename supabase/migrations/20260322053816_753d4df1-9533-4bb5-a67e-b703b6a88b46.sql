
-- ============================================================
-- MERGED FIX: Restore all missing logic in create_multi_vendor_orders
-- Merges: idempotency from 20260321, delivery_handled_by from 20260317,
-- delivery_fee/discount/coupon/payment_records from 20260313
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _seller_groups json,
  _delivery_address text,
  _notes text,
  _payment_method text,
  _payment_status text,
  _cart_total numeric DEFAULT 0,
  _coupon_id text DEFAULT NULL,
  _coupon_code text DEFAULT NULL,
  _coupon_discount numeric DEFAULT 0,
  _has_urgent boolean DEFAULT false,
  _delivery_fee numeric DEFAULT 0,
  _fulfillment_type text DEFAULT 'self_pickup',
  _delivery_address_id uuid DEFAULT NULL,
  _delivery_lat double precision DEFAULT NULL,
  _delivery_lng double precision DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
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
begin
  -- ============================================================
  -- SECURITY: ensure caller is the buyer
  -- ============================================================
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- ============================================================
  -- LAYER 1: Advisory lock — serialize all requests with same key
  -- ============================================================
  if _idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext(_idempotency_key));
  end if;

  -- ============================================================
  -- LAYER 2: Request-level dedup — fast path for retries
  -- ============================================================
  if _idempotency_key is not null then
    select array_agg(o.id order by o.created_at, o.id)
      into _existing_order_ids
    from public.orders o
    where o.buyer_id = _buyer_id
      and o.idempotency_key like _idempotency_key || ':%';

    if _existing_order_ids is not null and array_length(_existing_order_ids, 1) > 0 then
      return json_build_object(
        'success', true,
        'order_ids', to_json(_existing_order_ids),
        'deduplicated', true
      );
    end if;
  end if;

  -- ============================================================
  -- Resolve buyer profile & coupon
  -- ============================================================
  _resolved_coupon_id := NULLIF(_coupon_id, '')::uuid;

  select p.society_id, p.name
    into _society_id, _buyer_name
  from public.profiles p
  where p.id = _buyer_id;

  select json_array_length(_seller_groups) into _total_groups;

  -- ============================================================
  -- Validate all sellers: open status + delivery radius
  -- ============================================================
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

    -- Server-side delivery radius validation
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

  -- ============================================================
  -- 3-minute auto-cancel timer for purchase orders
  -- ============================================================
  _auto_cancel_at := now() + interval '3 minutes';

  -- ============================================================
  -- LAYER 3: Insert orders with ON CONFLICT DO NOTHING
  -- ============================================================
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
      _total := _total + ((_item->>'unit_price')::numeric * (_item->>'quantity')::int);
    end loop;

    -- Delivery fee on first order only; coupon discount on first order only
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

    -- Determine delivery_handled_by based on seller's fulfillment_mode
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

    -- Insert order with idempotency guard
    insert into public.orders (
      id, buyer_id, seller_id, society_id, status, total_amount,
      payment_type, payment_status, delivery_address, notes,
      order_type, fulfillment_type, delivery_address_id,
      delivery_lat, delivery_lng,
      delivery_fee, discount_amount, coupon_id,
      delivery_handled_by, idempotency_key, auto_cancel_at
    )
    values (
      _order_id, _buyer_id, _seller_id, _society_id, 'placed', _total,
      _payment_method, _payment_status, _delivery_address, _notes,
      'purchase', _fulfillment_type, _delivery_address_id,
      _delivery_lat, _delivery_lng,
      _order_delivery_fee, _order_discount,
      CASE WHEN _group_count = 1 THEN _resolved_coupon_id ELSE NULL END,
      _delivery_handled_by, _row_idempotency_key, _auto_cancel_at
    )
    on conflict (buyer_id, idempotency_key) where idempotency_key is not null
    do nothing;

    -- Check if insert happened or conflict was hit
    if not found then
      -- Dedup path: retrieve existing order
      select o.id into _found_existing_id
      from public.orders o
      where o.buyer_id = _buyer_id
        and o.idempotency_key = _row_idempotency_key;

      if _found_existing_id is not null then
        _order_id := _found_existing_id;
      end if;
    else
      -- ============================================================
      -- NEW ORDER: insert items, payment record, notify seller
      -- ============================================================
      for _item in select * from json_array_elements(_seller_group->'items')
      loop
        insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
        values (
          _order_id,
          (_item->>'product_id')::uuid,
          _item->>'product_name',
          (_item->>'quantity')::int,
          (_item->>'unit_price')::numeric
        );
      end loop;

      -- Payment record (required for Razorpay webhook duplicate guard & settlements)
      insert into public.payment_records (
        order_id, buyer_id, seller_id, amount,
        payment_method, payment_status,
        platform_fee, net_amount
      ) values (
        _order_id, _buyer_id, _seller_id, _total,
        _payment_method, _payment_status,
        0, _total
      );

      -- Seller notification
      select sp.user_id into _seller_user_id
      from public.seller_profiles sp where sp.id = _seller_id;

      if _seller_user_id is not null then
        insert into public.notification_queue (user_id, type, title, body, reference_path, payload)
        values (
          _seller_user_id, 'order',
          '🆕 New Order Received!',
          coalesce(_buyer_name, 'A buyer') || ' placed an order. Tap to view and accept.',
          '/orders/' || _order_id::text,
          jsonb_build_object('orderId', _order_id::text, 'status', 'placed', 'type', 'order')
        );
      end if;
    end if;

    _order_ids := _order_ids || _order_id;
  end loop;

  -- ============================================================
  -- Coupon redemption tracking (first order only)
  -- ============================================================
  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied)
    values (_resolved_coupon_id, _first_order_id, _buyer_id, _coupon_discount);

    update public.coupons set times_used = times_used + 1 where id = _resolved_coupon_id;
  end if;

  -- Cart clearing is handled client-side after payment confirmation.

  -- ============================================================
  -- LAYER 4: Canonical response — always return full set from DB
  -- ============================================================
  if _idempotency_key is not null then
    select array_agg(o.id order by o.created_at, o.id)
      into _existing_order_ids
    from public.orders o
    where o.buyer_id = _buyer_id
      and o.idempotency_key like _idempotency_key || ':%';

    if _existing_order_ids is not null and array_length(_existing_order_ids, 1) > 0 then
      return json_build_object('success', true, 'order_ids', to_json(_existing_order_ids));
    end if;
  end if;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids));
end;
$function$;
