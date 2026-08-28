-- P0: Block partial multi-seller checkout (no silent cart drops).
-- P0: Server-side gate for service products missing service_listings on onboarding submit.

-- ── 1) create_multi_vendor_orders: fail before side-effects if any seller group skipped ──
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _seller_groups json,
  _fulfillment_type text DEFAULT 'delivery'::text,
  _delivery_address text DEFAULT NULL::text,
  _delivery_address_id uuid DEFAULT NULL::uuid,
  _delivery_lat double precision DEFAULT NULL::double precision,
  _delivery_lng double precision DEFAULT NULL::double precision,
  _notes text DEFAULT NULL::text,
  _payment_method text DEFAULT 'cod'::text,
  _payment_status text DEFAULT 'pending'::text,
  _delivery_fee numeric DEFAULT 0,
  _coupon_id text DEFAULT NULL::text,
  _coupon_discount numeric DEFAULT 0,
  _idempotency_key text DEFAULT NULL::text,
  _preorder_seller_ids uuid[] DEFAULT NULL::uuid[],
  _scheduled_date text DEFAULT NULL::text,
  _scheduled_time_start text DEFAULT NULL::text,
  _loyalty_points integer DEFAULT 0,
  _wallet_amount numeric DEFAULT 0
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
  _credit_blocked_sellers text[] := '{}';
  _credit_gate jsonb;
  _seller_lat double precision;
  _seller_lng double precision;
  _seller_radius double precision;
  _distance double precision;
  _out_of_range text[] := '{}';
  _group_count int := 0;
  _total_groups int;
  _resolved_coupon_id uuid;
  _first_order_id uuid;
  _seller_fulfillment_mode text;
  _delivery_handled_by text;
  _existing_order_ids uuid[];
  _row_idempotency_key text;
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
  _resolved_product_name text;
  _resolved_product_image text;
  _stock_rows int;
  _tracks_stock boolean;
  _loyalty_result jsonb;
  _wallet_result jsonb;
  _skipped_sellers text[] := '{}';
  _created_count int;
begin
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  _delivery_fee := public.resolve_platform_delivery_fee(
    coalesce(_fulfillment_type, 'delivery'),
    _seller_groups
  );

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
        _unavailable_items := array_append(_unavailable_items, COALESCE(_product_row.name, _product_id::text));
        continue;
      end if;

      if _product_row.action_type is not null then
        select atm.checkout_mode into _item_checkout_mode
        from public.action_type_workflow_map atm
        where atm.action_type = _product_row.action_type;

        if _item_checkout_mode is not null and _item_checkout_mode <> 'cart' then
          _non_cart_items := array_append(_non_cart_items, COALESCE(_product_row.name, _product_id::text));
          continue;
        end if;
      end if;

      if _product_row.stock_quantity is not null and _product_row.stock_quantity < _client_qty then
        _stock_insufficient := array_append(_stock_insufficient, COALESCE(_product_row.name, _product_id::text) || ' (available: ' || _product_row.stock_quantity || ')');
        continue;
      end if;

      if _product_row.price is distinct from _client_price then
        _price_changed_items := array_append(_price_changed_items,
          COALESCE(_product_row.name, _product_id::text) || ' (was INR ' || _client_price || ', now INR ' || _product_row.price || ')'
        );
      end if;
    end loop;
  end loop;

  if array_length(_unavailable_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'unavailable_items', 'items', to_json(_unavailable_items));
  end if;

  if array_length(_non_cart_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'non_cart_items', 'items', to_json(_non_cart_items),
      'message', 'Some items cannot be ordered via cart');
  end if;

  if array_length(_stock_insufficient, 1) > 0 then
    return json_build_object('success', false, 'error', 'insufficient_stock', 'items', to_json(_stock_insufficient));
  end if;

  if array_length(_price_changed_items, 1) > 0 then
    return json_build_object('success', false, 'error', 'price_changed', 'items', to_json(_price_changed_items));
  end if;

  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _seller_id := (_seller_group->>'seller_id')::uuid;

    select sp.user_id, sp.business_name,
           public.compute_store_status(sp.availability_start, sp.availability_end, sp.manual_override, sp.manual_override_until),
           sp.latitude, sp.longitude, sp.delivery_radius_km,
           sp.fulfillment_mode, sp.delivery_handled_by,
           case
             when _fulfillment_type = 'self_pickup' then sp.pickup_payment_config
             else sp.delivery_payment_config
           end
    into _seller_user_id, _seller_name, _seller_status,
         _seller_lat, _seller_lng, _seller_radius,
         _seller_fulfillment_mode, _delivery_handled_by,
         _seller_payment_config
    from public.seller_profiles sp where sp.id = _seller_id;

    _seller_status_text := _seller_status ->> 'status';

    if _seller_status_text is not null
       and _seller_status_text not in ('open', 'accepting_preorders')
       and not (_preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids)) then
      _closed_sellers := array_append(_closed_sellers, COALESCE(_seller_name, _seller_id::text));
      continue;
    end if;

    if _payment_method = 'cod' then
      _config_accepts_cod := coalesce((_seller_payment_config->>'accepts_cod')::boolean, true);
      if not _config_accepts_cod then
        _payment_blocked_sellers := array_append(_payment_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    elsif _payment_method = 'online' then
      _config_accepts_online := coalesce((_seller_payment_config->>'accepts_online')::boolean, true);
      if not _config_accepts_online then
        _payment_blocked_sellers := array_append(_payment_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    end if;

    if coalesce(_fulfillment_type, 'delivery') <> 'self_pickup' then
      if not public.buyer_coordinates_are_valid(_delivery_lat, _delivery_lng) then
        return json_build_object(
          'success', false,
          'error', 'buyer_location',
          'message', 'Your selected address has no location coordinates. Please update it with a precise location.'
        );
      end if;
      if _seller_lat is null or _seller_lng is null
         or _seller_radius is null or _seller_radius <= 0
         or not public.seller_is_eligible_for_discovery(_seller_id) then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
      _distance := 6371 * acos(
        least(1.0, cos(radians(_seller_lat)) * cos(radians(_delivery_lat))
        * cos(radians(_delivery_lng) - radians(_seller_lng))
        + sin(radians(_seller_lat)) * sin(radians(_delivery_lat)))
      );
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    elsif not public.seller_is_eligible_for_discovery(_seller_id) then
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      continue;
    end if;

    _group_count := _group_count + 1;
    _order_id := gen_random_uuid();
    _total := 0;

    if _idempotency_key is not null then
      _row_idempotency_key := _idempotency_key || ':' || _group_count;
    else
      _row_idempotency_key := null;
    end if;

    if _seller_status_text = 'accepting_preorders'
       or (_preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids)) then
      _auto_cancel_at := now() + interval '30 minutes';
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _auto_cancel_at := null;
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;

    SELECT atm.transaction_type INTO _resolved_tx_type
    FROM public.action_type_workflow_map atm
    WHERE atm.action_type = 'add_to_cart'
    LIMIT 1;

    IF NOT public.seller_credit_activation_satisfied(_seller_id) THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
    _credit_gate := public.seller_credit_can_accept(_seller_id, 'ORDER_COMPLETED');
    IF COALESCE((_credit_gate->>'ok')::boolean, false) IS NOT TRUE THEN
      _credit_blocked_sellers := array_append(_credit_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
      CONTINUE;
    END IF;
    insert into public.orders (
      id, buyer_id, seller_id, total_amount, status, order_type, notes,
      fulfillment_type, delivery_address, delivery_address_id,
      delivery_lat, delivery_lng,
      payment_type, payment_status, delivery_fee, coupon_discount,
      idempotency_key, delivery_handled_by, auto_cancel_at,
      scheduled_date, scheduled_time_start,
      transaction_type,
      loyalty_discount_amount, loyalty_points_redeemed
    ) values (
      _order_id, _buyer_id, _seller_id, 0, _effective_status::public.order_status, 'purchase', _notes,
      _fulfillment_type, _delivery_address, _delivery_address_id,
      _delivery_lat, _delivery_lng,
      _payment_method, _payment_status,
      case when _group_count = 1 then _delivery_fee else 0 end,
      case when _group_count = 1 then _coupon_discount else 0 end,
      _row_idempotency_key, _delivery_handled_by, _auto_cancel_at,
      _effective_scheduled_date::date, _effective_scheduled_time::time,
      COALESCE(_resolved_tx_type, 'cart_purchase'),
      0, 0
    );

    if _first_order_id is null then
      _first_order_id := _order_id;
    end if;

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _product_id := (_item->>'product_id')::uuid;

      SELECT
        COALESCE((_item->>'product_name'), p.name, 'Unknown Product'),
        COALESCE((_item->>'product_image'), p.image_url)
      INTO _resolved_product_name, _resolved_product_image
      FROM public.products p
      WHERE p.id = _product_id;

      IF _resolved_product_name IS NULL THEN
        _resolved_product_name := COALESCE((_item->>'product_name'), 'Unknown Product');
      END IF;

      insert into public.order_items (
        order_id, product_id, quantity, unit_price, subtotal, product_name, product_image
      ) values (
        _order_id,
        _product_id,
        (_item->>'quantity')::int,
        (_item->>'unit_price')::numeric,
        ((_item->>'quantity')::int * (_item->>'unit_price')::numeric),
        _resolved_product_name,
        _resolved_product_image
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

  _created_count := coalesce(array_length(_order_ids, 1), 0);

  -- P0: Never commit a partial multi-seller checkout — roll back and preserve cart.
  if _total_groups > 1 and _created_count > 0 and _created_count < _total_groups then
    delete from public.orders where id = any(_order_ids);
    _skipped_sellers := _closed_sellers || _out_of_range || _payment_blocked_sellers || _credit_blocked_sellers;
    return json_build_object(
      'success', false,
      'error', 'partial_checkout_blocked',
      'message', 'Checkout cannot complete for all stores in your cart. Remove unavailable stores or order from each store separately.',
      'skipped_sellers', to_json(_skipped_sellers),
      'closed_sellers', to_json(_closed_sellers),
      'out_of_range_sellers', to_json(_out_of_range),
      'payment_blocked_sellers', to_json(_payment_blocked_sellers),
      'credit_blocked_sellers', to_json(_credit_blocked_sellers),
      'created_count', _created_count,
      'total_groups', _total_groups
    );
  end if;

  if array_length(_closed_sellers, 1) > 0 and _created_count = 0 then
    return json_build_object('success', false, 'error', 'sellers_closed', 'sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 and _created_count = 0 then
    return json_build_object('success', false, 'error', 'out_of_range', 'sellers', to_json(_out_of_range));
  end if;

  if array_length(_payment_blocked_sellers, 1) > 0 and _created_count = 0 then
    return json_build_object(
      'success', false,
      'error', 'payment_method_not_accepted',
      'sellers', to_json(_payment_blocked_sellers),
      'message', 'Selected payment method is not accepted by: ' || array_to_string(_payment_blocked_sellers, ', ')
    );
  end if;

  if array_length(_credit_blocked_sellers, 1) > 0 and _created_count = 0 then
    return json_build_object(
      'success', false,
      'error', 'credit_blocked',
      'sellers', to_json(_credit_blocked_sellers),
      'message', 'This seller is currently unavailable for new orders.'
    );
  end if;

  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_applied)
    values (_resolved_coupon_id, _buyer_id, _first_order_id, _coupon_discount);

    update public.coupons
    set times_used = times_used + 1
    where id = _resolved_coupon_id;
  end if;

  if coalesce(_loyalty_points, 0) > 0 and _created_count > 0 then
    _loyalty_result := public.apply_loyalty_to_checkout_orders(
      _buyer_id,
      _order_ids,
      _loyalty_points,
      _payment_method,
      _idempotency_key
    );
    if coalesce((_loyalty_result->>'success')::boolean, false) is not true then
      raise exception 'loyalty_apply_failed: %', coalesce(_loyalty_result->>'error', 'unknown')
        using errcode = 'P0001';
    end if;
  end if;

  if coalesce(_wallet_amount, 0) > 0 and _created_count > 0 then
    _wallet_result := public.apply_wallet_to_checkout_orders(
      _buyer_id,
      _order_ids,
      _wallet_amount,
      _payment_method,
      _idempotency_key
    );
    if coalesce((_wallet_result->>'success')::boolean, false) is not true then
      raise exception 'wallet_apply_failed: %', coalesce(_wallet_result->>'error', 'unknown')
        using errcode = 'P0001';
    end if;
  end if;

  if _created_count > 0 then
    for _product_id, _client_qty in
      select oi.product_id, sum(oi.quantity)::int
      from public.order_items oi
      where oi.order_id = any (_order_ids)
      group by oi.product_id
    loop
      select stock_quantity is not null into _tracks_stock
      from public.products where id = _product_id;

      if coalesce(_tracks_stock, false) then
        update public.products
        set stock_quantity = stock_quantity - _client_qty,
            is_available = case
              when stock_quantity - _client_qty <= 0 then false
              else is_available
            end
        where id = _product_id
          and stock_quantity is not null
          and stock_quantity >= _client_qty;

        get diagnostics _stock_rows = row_count;
        if _stock_rows = 0 then
          raise exception 'insufficient_stock for product %', _product_id
            using errcode = 'P0001';
        end if;
      end if;
    end loop;
  end if;

  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;

  return json_build_object(
    'success', true,
    'order_ids', to_json(_order_ids),
    'loyalty', _loyalty_result,
    'wallet', _wallet_result
  );
end;
$function$;

-- ── 2) Onboarding submit: reject service stores with products missing service_listings ──
CREATE OR REPLACE FUNCTION public.validate_seller_service_products_ready(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_missing record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles sp
    WHERE sp.id = p_seller_id AND sp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'seller not found';
  END IF;

  SELECT p.id, p.name
  INTO v_missing
  FROM public.products p
  LEFT JOIN public.service_listings sl ON sl.product_id = p.id
  LEFT JOIN public.action_type_workflow_map atm ON atm.action_type = COALESCE(
    p.action_type,
    (SELECT sp.default_action_type FROM public.seller_profiles sp WHERE sp.id = p_seller_id)
  )
  WHERE p.seller_id = p_seller_id
    AND COALESCE(atm.requires_availability, false) = true
    AND sl.product_id IS NULL
  ORDER BY p.created_at
  LIMIT 1;

  IF v_missing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'product_id', v_missing.id,
      'product_name', v_missing.name,
      'reason', format('Service settings are missing for "%s". Open it, save again, then continue.', v_missing.name)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_seller_service_products_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_seller_service_products_ready(uuid) TO authenticated, service_role;
