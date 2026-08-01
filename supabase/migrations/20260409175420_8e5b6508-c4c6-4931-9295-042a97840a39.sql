
CREATE OR REPLACE FUNCTION public.check_first_order_batch(_buyer_id uuid, _seller_ids uuid[]) RETURNS TABLE(seller_id uuid, is_first_order boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT s.id,
    NOT EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.buyer_id = _buyer_id AND o.seller_id = s.id
        AND o.status IN ('completed', 'delivered', 'ready')
    )
  FROM unnest(_seller_ids) AS s(id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(_buyer_id uuid, _seller_groups json, _fulfillment_type text DEFAULT 'delivery'::text, _delivery_address text DEFAULT NULL::text, _delivery_address_id uuid DEFAULT NULL::uuid, _delivery_lat double precision DEFAULT NULL::double precision, _delivery_lng double precision DEFAULT NULL::double precision, _notes text DEFAULT NULL::text, _payment_method text DEFAULT 'cod'::text, _payment_status text DEFAULT 'pending'::text, _delivery_fee numeric DEFAULT 0, _coupon_id text DEFAULT NULL::text, _coupon_discount numeric DEFAULT 0, _idempotency_key text DEFAULT NULL::text, _preorder_seller_ids uuid[] DEFAULT NULL::uuid[], _scheduled_date text DEFAULT NULL::text, _scheduled_time_start text DEFAULT NULL::text) RETURNS json
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
  _resolved_tx_type text;
  _item_checkout_mode text;
  _non_cart_items text[] := '{}';
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

      select id, name, price, is_available, approval_status, seller_id, stock_quantity, action_type
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

      SELECT atm.checkout_mode INTO _item_checkout_mode
      FROM public.action_type_workflow_map atm
      WHERE atm.action_type = COALESCE(_product_row.action_type, 'add_to_cart');

      IF _item_checkout_mode IS DISTINCT FROM 'cart' THEN
        _non_cart_items := array_append(_non_cart_items, COALESCE(_product_row.name, '') || ' (' || COALESCE(_item_checkout_mode, 'unknown') || ')');
      END IF;

      if abs(_product_row.price - _client_price) > 0.01 then
        _price_changed_items := array_append(_price_changed_items, COALESCE(_product_row.name, '') || ': ' || _client_price || ' → ' || _product_row.price);
      end if;

      if _product_row.stock_quantity is not null and _product_row.stock_quantity < _client_qty then
        _stock_insufficient := array_append(_stock_insufficient, COALESCE(_product_row.name, '') || ' (only ' || COALESCE(_product_row.stock_quantity, 0) || ' left)');
      end if;
    end loop;
  end loop;

  if array_length(_non_cart_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'non_cart_items', 'non_cart_items', to_json(_non_cart_items));
  end if;

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
      when _idempotency_key is not null then _idempotency_key || ':' || _seller_id::text
      else null
    end;

    select sp.user_id, sp.fulfillment_mode
      into _seller_user_id, _seller_fulfillment_mode
    from public.seller_profiles sp where sp.id = _seller_id;

    if _fulfillment_type = 'delivery' then
      if _seller_fulfillment_mode = 'delivery' or _seller_fulfillment_mode = 'both' then
        _delivery_handled_by := 'seller';
      else
        _delivery_handled_by := 'platform';
      end if;
    else
      _delivery_handled_by := null;
    end if;

    _effective_scheduled_date := null;
    _effective_scheduled_time := null;
    if _preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids) then
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    end if;

    SELECT atm.transaction_type INTO _resolved_tx_type
    FROM public.action_type_workflow_map atm
    WHERE atm.action_type = 'add_to_cart'
    LIMIT 1;

    insert into public.orders (
      id, buyer_id, seller_id, total_amount, status, order_type, notes,
      fulfillment_type, delivery_address, delivery_address_id,
      delivery_lat, delivery_lng,
      payment_type, payment_status, delivery_fee, coupon_discount,
      idempotency_key, delivery_handled_by, auto_cancel_at,
      scheduled_date, scheduled_time_start,
      transaction_type
    ) values (
      _order_id, _buyer_id, _seller_id, 0, _effective_status::public.order_status, 'purchase', _notes,
      _fulfillment_type, _delivery_address, _delivery_address_id,
      _delivery_lat, _delivery_lng,
      _payment_method, _payment_status,
      case when _group_count = 1 then _delivery_fee else 0 end,
      case when _group_count = 1 then _coupon_discount else 0 end,
      _row_idempotency_key, _delivery_handled_by, _auto_cancel_at,
      _effective_scheduled_date::date, _effective_scheduled_time::time,
      COALESCE(_resolved_tx_type, 'cart_purchase')
    );

    if _first_order_id is null then
      _first_order_id := _order_id;
    end if;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      insert into public.order_items (
        order_id, product_id, quantity, unit_price, subtotal, product_name, product_image
      ) values (
        _order_id,
        (_item->>'product_id')::uuid,
        (_item->>'quantity')::int,
        (_item->>'unit_price')::numeric,
        ((_item->>'quantity')::int * (_item->>'unit_price')::numeric),
        (_item->>'product_name'),
        (_item->>'product_image')
      );
      _total := _total + ((_item->>'quantity')::int * (_item->>'unit_price')::numeric);
    end loop;

    update public.orders
    set total_amount = _total
        + (case when _group_count = 1 then _delivery_fee else 0 end)
        - (case when _group_count = 1 then _coupon_discount else 0 end)
    where id = _order_id;

    _order_ids := array_append(_order_ids, _order_id);
  end loop;

  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;
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
