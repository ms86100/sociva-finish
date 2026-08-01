
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _seller_groups json,
  _delivery_address text,
  _notes text,
  _payment_method text,
  _payment_status text,
  _cart_total numeric,
  _coupon_id text DEFAULT ''::text,
  _coupon_code text DEFAULT ''::text,
  _coupon_discount numeric DEFAULT 0,
  _has_urgent boolean DEFAULT false,
  _delivery_fee numeric DEFAULT 0,
  _fulfillment_type text DEFAULT 'delivery'::text,
  _delivery_address_id uuid DEFAULT NULL,
  _delivery_lat numeric DEFAULT NULL,
  _delivery_lng numeric DEFAULT NULL,
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
  _existing_order_ids uuid[];
begin
  -- Idempotency check: if this key was used recently, return existing orders
  if _idempotency_key is not null then
    select array_agg(o.id) into _existing_order_ids
    from public.orders o
    where o.idempotency_key = _idempotency_key
      and o.buyer_id = _buyer_id
      and o.created_at > now() - interval '5 minutes';

    if _existing_order_ids is not null and array_length(_existing_order_ids, 1) > 0 then
      return json_build_object('success', true, 'order_ids', to_json(_existing_order_ids), 'deduplicated', true);
    end if;
  end if;

  select p.society_id, p.name
    into _society_id, _buyer_name
  from public.profiles p
  where p.id = _buyer_id;

  -- Pre-validate all sellers first to avoid partial order creation
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.business_name,
           public.compute_store_status(
             sp.availability_start,
             sp.availability_end,
             sp.operating_days,
             coalesce(sp.is_available, true)
           )
      into _seller_name, _seller_status
    from public.seller_profiles sp
    where sp.id = _seller_id;

    if _seller_status is null then
      return json_build_object(
        'success', false,
        'error', 'seller_not_found',
        'seller_id', _seller_id
      );
    end if;

    _seller_status_text := coalesce(_seller_status->>'status', 'closed');
    if _seller_status_text <> 'open' then
      _closed_sellers := array_append(_closed_sellers, coalesce(_seller_name, 'Seller'));
    end if;
  end loop;

  if array_length(_closed_sellers, 1) > 0 then
    return json_build_object(
      'success', false,
      'error', 'store_closed',
      'closed_sellers', to_json(_closed_sellers)
    );
  end if;

  -- Order creation
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _total := 0;
    _order_id := gen_random_uuid();

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _total := _total + ((_item->>'unit_price')::numeric * (_item->>'quantity')::int);
    end loop;

    insert into public.orders (
      id,
      buyer_id,
      seller_id,
      society_id,
      status,
      total_amount,
      payment_type,
      payment_status,
      delivery_address,
      notes,
      order_type,
      fulfillment_type,
      delivery_address_id,
      delivery_lat,
      delivery_lng,
      idempotency_key
    )
    values (
      _order_id,
      _buyer_id,
      (_seller_group->>'seller_id')::uuid,
      _society_id,
      'placed',
      _total,
      _payment_method,
      _payment_status,
      _delivery_address,
      _notes,
      'purchase',
      _fulfillment_type,
      _delivery_address_id,
      _delivery_lat,
      _delivery_lng,
      _idempotency_key
    );

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

    select sp.user_id
      into _seller_user_id
    from public.seller_profiles sp
    where sp.id = (_seller_group->>'seller_id')::uuid;

    if _seller_user_id is not null then
      insert into public.notification_queue (user_id, type, title, body, reference_path, payload)
      values (
        _seller_user_id,
        'order',
        '🆕 New Order Received!',
        coalesce(_buyer_name, 'A buyer') || ' placed an order. Tap to view and accept.',
        '/orders/' || _order_id::text,
        jsonb_build_object('orderId', _order_id::text, 'status', 'placed', 'type', 'order')
      );
    end if;

    _order_ids := _order_ids || _order_id;
  end loop;

  delete from public.cart_items where user_id = _buyer_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids));
end;
$function$;
