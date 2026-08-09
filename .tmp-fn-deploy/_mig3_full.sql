-- ============================================================
-- Sociva Credit MVP E2E gaps
-- 1) Restore wallet-aware CMVO (21335 reintroduced loyalty-only overload)
-- 2) Mark Rs 0 residual orders paid inside SECURITY DEFINER CMVO
--    (client UPDATE is blocked by trg_guard_order_payment_status)
-- 3) Treat payment_method=wallet as prepaid (commit holds, skip COD gate)
-- 4) Schedule daily expire_wallet_lots via pg_cron
-- ============================================================

-- Immediate commit for wallet payment method (mirrors COD)
CREATE OR REPLACE FUNCTION public.apply_loyalty_to_checkout_orders(
  _buyer_id uuid,
  _order_ids uuid[],
  _loyalty_points integer,
  _payment_method text,
  _checkout_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _redeem integer;
  _quote_base numeric := 0;
  _bases numeric[] := '{}';
  _oids uuid[] := '{}';
  _alloc integer[] := '{}';
  _i int;
  _n int;
  _remaining integer;
  _share integer;
  _sum_bases numeric;
  _res jsonb;
  _reservation_id uuid;
  o record;
BEGIN
  IF _loyalty_points IS NULL OR _loyalty_points <= 0 THEN
    RETURN jsonb_build_object('success', true, 'points', 0, 'skipped', true);
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  -- Build redeemable bases (items+fees already in total; remove delivery+loyalty none yet; add back coupon already applied)
  -- Redeemable = total_amount - delivery_fee + 0 (coupon already in total)
  -- Match UI: loyalty applies to merchandise after coupon, NOT delivery fee.
  FOR o IN
    SELECT id, total_amount, COALESCE(delivery_fee, 0) AS delivery_fee, seller_id
    FROM public.orders
    WHERE id = ANY(_order_ids) AND buyer_id = _buyer_id
    ORDER BY created_at, id
  LOOP
    _oids := array_append(_oids, o.id);
    _bases := array_append(_bases, GREATEST(o.total_amount - o.delivery_fee, 0));
    _quote_base := _quote_base + GREATEST(o.total_amount - o.delivery_fee, 0);
  END LOOP;

  _n := coalesce(array_length(_oids, 1), 0);
  IF _n = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'orders_not_found');
  END IF;

  _redeem := LEAST(_loyalty_points, FLOOR(_quote_base)::integer);
  IF _redeem <= 0 THEN
    RETURN jsonb_build_object('success', true, 'points', 0, 'skipped', true);
  END IF;

  -- Reserve first (locks wallet)
  _res := public.reserve_loyalty_points(
    _redeem,
    CASE WHEN _checkout_key IS NULL THEN NULL ELSE 'checkout-reserve:' || _checkout_key END,
    _checkout_key,
    _oids
  );

  IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN _res;
  END IF;
  _reservation_id := (_res->>'reservation_id')::uuid;

  -- Largest-remainder proportional allocation
  _sum_bases := NULLIF(_quote_base, 0);
  _remaining := _redeem;
  FOR _i IN 1.._n LOOP
    IF _i = _n THEN
      _share := _remaining;
    ELSE
      _share := FLOOR(_redeem * (_bases[_i] / _sum_bases))::integer;
      _remaining := _remaining - _share;
    END IF;
    _alloc := array_append(_alloc, _share);
  END LOOP;

  FOR _i IN 1.._n LOOP
    IF _alloc[_i] > 0 THEN
      UPDATE public.orders
      SET
        loyalty_points_redeemed = _alloc[_i],
        loyalty_discount_amount = _alloc[_i]::numeric,
        loyalty_reservation_id = _reservation_id,
        total_amount = GREATEST(total_amount - _alloc[_i], 0)
      WHERE id = _oids[_i];
    ELSE
      UPDATE public.orders
      SET loyalty_reservation_id = _reservation_id
      WHERE id = _oids[_i];
    END IF;
  END LOOP;

  -- COD: commit immediately (buyer owes discounted COD amount)
  IF lower(COALESCE(_payment_method, 'cod')) IN ('cod', 'wallet') THEN
    _res := public.commit_loyalty_reservation(_reservation_id, _oids);
    IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
      PERFORM public.release_loyalty_reservation(_reservation_id);
      RETURN _res;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', _reservation_id,
    'points', _redeem,
    'discount_rupees', _redeem,
    'allocations', _alloc,
    'order_ids', to_json(_oids),
    'status', CASE WHEN lower(COALESCE(_payment_method, 'cod')) IN ('cod', 'wallet') THEN 'committed' ELSE 'held' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_wallet_to_checkout_orders(
  _buyer_id uuid,
  _order_ids uuid[],
  _wallet_amount numeric,
  _payment_method text,
  _checkout_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _want numeric := ROUND(GREATEST(COALESCE(_wallet_amount, 0), 0)::numeric, 2);
  _quote_base numeric := 0;
  _bases numeric[] := '{}';
  _oids uuid[] := '{}';
  _cash_alloc numeric[] := '{}';
  _promo_alloc numeric[] := '{}';
  _i int;
  _n int;
  _remaining_cash numeric;
  _remaining_promo numeric;
  _share_total numeric;
  _share_cash numeric;
  _share_promo numeric;
  _sum_bases numeric;
  _res jsonb;
  _reservation_id uuid;
  _plan jsonb;
  o record;
  _cash_total numeric;
  _promo_total numeric;
BEGIN
  IF _want <= 0 THEN
    RETURN jsonb_build_object('success', true, 'amount', 0, 'skipped', true);
  END IF;

  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  -- Wallet-eligible = full remaining payable (includes delivery) per architecture study
  FOR o IN
    SELECT id, total_amount, seller_id, created_at
    FROM public.orders
    WHERE id = ANY(_order_ids) AND buyer_id = _buyer_id
    ORDER BY created_at, id
  LOOP
    _oids := array_append(_oids, o.id);
    _bases := array_append(_bases, GREATEST(o.total_amount, 0));
    _quote_base := _quote_base + GREATEST(o.total_amount, 0);
  END LOOP;

  _n := coalesce(array_length(_oids, 1), 0);
  IF _n = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'orders_not_found');
  END IF;

  _want := LEAST(_want, ROUND(_quote_base::numeric, 2));
  IF _want <= 0 THEN
    RETURN jsonb_build_object('success', true, 'amount', 0, 'skipped', true);
  END IF;

  -- Reserve first (locks wallet, promo-first plan)
  _res := public.reserve_wallet_credit(
    _want,
    CASE WHEN _checkout_key IS NULL THEN NULL ELSE 'wallet-checkout-reserve:' || _checkout_key END,
    _checkout_key,
    _oids
  );

  IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
    RETURN _res;
  END IF;

  _reservation_id := (_res->>'reservation_id')::uuid;
  _cash_total := COALESCE((_res->>'cash_amount')::numeric, 0);
  _promo_total := COALESCE((_res->>'promo_amount')::numeric, 0);

  -- Proportional allocation of cash+promo across orders by payable base
  _sum_bases := NULLIF(_quote_base, 0);
  _remaining_cash := _cash_total;
  _remaining_promo := _promo_total;

  FOR _i IN 1.._n LOOP
    IF _i = _n THEN
      _share_cash := _remaining_cash;
      _share_promo := _remaining_promo;
    ELSE
      _share_total := ROUND((_bases[_i] / _sum_bases) * (_cash_total + _promo_total), 2);
      -- Split share promo-first within order
      _plan := public.wallet_plan_spend(
        -- temporary: allocate from remaining pools proportionally
        ROUND((_bases[_i] / _sum_bases) * _cash_total, 2),
        ROUND((_bases[_i] / _sum_bases) * _promo_total, 2),
        _share_total
      );
      -- Use proportional slice of each bucket (more accurate for settlement)
      _share_promo := ROUND((_bases[_i] / _sum_bases) * _promo_total, 2);
      _share_cash := ROUND((_bases[_i] / _sum_bases) * _cash_total, 2);
      _remaining_cash := ROUND((_remaining_cash - _share_cash)::numeric, 2);
      _remaining_promo := ROUND((_remaining_promo - _share_promo)::numeric, 2);
    END IF;

    _cash_alloc := array_append(_cash_alloc, _share_cash);
    _promo_alloc := array_append(_promo_alloc, _share_promo);
  END LOOP;

  FOR _i IN 1.._n LOOP
    UPDATE public.orders
    SET
      wallet_cash_amount = COALESCE(_cash_alloc[_i], 0),
      wallet_promo_amount = COALESCE(_promo_alloc[_i], 0),
      wallet_reservation_id = _reservation_id,
      total_amount = GREATEST(
        total_amount - COALESCE(_cash_alloc[_i], 0) - COALESCE(_promo_alloc[_i], 0),
        0
      )
    WHERE id = _oids[_i];
  END LOOP;

  IF lower(COALESCE(_payment_method, 'cod')) IN ('cod', 'wallet') THEN
    _res := public.commit_wallet_reservation(_reservation_id, _oids);
    IF COALESCE((_res->>'success')::boolean, false) IS NOT TRUE THEN
      PERFORM public.release_wallet_reservation(_reservation_id);
      RETURN _res;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reservation_id', _reservation_id,
    'cash_amount', _cash_total,
    'promo_amount', _promo_total,
    'total', ROUND((_cash_total + _promo_total)::numeric, 2),
    'order_ids', to_json(_oids),
    'status', CASE WHEN lower(COALESCE(_payment_method, 'cod')) IN ('cod', 'wallet') THEN 'committed' ELSE 'held' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_loyalty_to_checkout_orders(uuid, uuid[], integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_wallet_to_checkout_orders(uuid, uuid[], numeric, text, text) TO service_role;

-- Drop loyalty-only overload reintroduced by 20260807121335 (PostgREST ambiguity)
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(
  uuid, json, text, text, uuid, double precision, double precision, text, text, text,
  numeric, text, numeric, text, uuid[], text, text, integer
);
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(
  uuid, json, text, text, uuid, double precision, double precision, text, text, text,
  numeric, text, numeric, text, uuid[], text, text, integer
);
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _seller_groups json,
  _fulfillment_type text DEFAULT 'delivery',
  _delivery_address text DEFAULT NULL,
  _delivery_address_id uuid DEFAULT NULL,
  _delivery_lat double precision DEFAULT NULL,
  _delivery_lng double precision DEFAULT NULL,
  _notes text DEFAULT NULL,
  _payment_method text DEFAULT 'cod',
  _payment_status text DEFAULT 'pending',
  _delivery_fee numeric DEFAULT 0,
  _coupon_id text DEFAULT NULL,
  _coupon_discount numeric DEFAULT 0,
  _idempotency_key text DEFAULT NULL,
  _preorder_seller_ids uuid[] DEFAULT NULL,
  _scheduled_date text DEFAULT NULL,
  _scheduled_time_start text DEFAULT NULL,
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
begin
  if _buyer_id != auth.uid() then
    return json_build_object('success', false, 'error', 'unauthorized');
  end if;

  -- cod + wallet are prepaid paths (placed immediately; wallet commits in apply_*)
  if _payment_status = 'pending' and lower(coalesce(_payment_method, 'cod')) not in ('cod', 'wallet') then
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
    elsif lower(_payment_method) = 'wallet' then
      -- Platform store-credit cover: no seller COD/online acceptance required
      null;
    elsif _payment_method = 'online' then
      _config_accepts_online := coalesce((_seller_payment_config->>'accepts_online')::boolean, false);
      if not _config_accepts_online then
        _payment_blocked_sellers := array_append(_payment_blocked_sellers, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
    end if;

    if _seller_lat is not null and _seller_lng is not null
       and _delivery_lat is not null and _delivery_lng is not null
       and _seller_radius is not null and _seller_radius > 0 then
      _distance := 6371 * acos(
        least(1.0, cos(radians(_seller_lat)) * cos(radians(_delivery_lat))
        * cos(radians(_delivery_lng) - radians(_seller_lng))
        + sin(radians(_seller_lat)) * sin(radians(_delivery_lat)))
      );
      if _distance > _seller_radius then
        _out_of_range := array_append(_out_of_range, COALESCE(_seller_name, _seller_id::text));
        continue;
      end if;
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

    -- Pre-loyalty total (coupon + delivery). Loyalty applied atomically after all groups.
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
      _client_qty := (_item->>'quantity')::int;

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
  end loop;

  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_applied)
    values (_resolved_coupon_id, _buyer_id, _first_order_id, _coupon_discount);

    update public.coupons
    set times_used = times_used + 1
    where id = _resolved_coupon_id;
  end if;

  if array_length(_closed_sellers, 1) > 0 and array_length(_order_ids, 1) = 0 then
    return json_build_object('success', false, 'error', 'sellers_closed', 'sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 and array_length(_order_ids, 1) = 0 then
    return json_build_object('success', false, 'error', 'out_of_range', 'sellers', to_json(_out_of_range));
  end if;

  if array_length(_payment_blocked_sellers, 1) > 0 and array_length(_order_ids, 1) = 0 then
    return json_build_object(
      'success', false,
      'error', 'payment_method_not_accepted',
      'sellers', to_json(_payment_blocked_sellers),
      'message', 'Selected payment method is not accepted by: ' || array_to_string(_payment_blocked_sellers, ', ')
    );
  end if;

  -- Platform-funded loyalty: reserve + proportional allocate; COD commits immediately
  if coalesce(_loyalty_points, 0) > 0 and array_length(_order_ids, 1) > 0 then
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

  -- Sociva Credit: after loyalty, reserve + allocate remaining payable (incl. delivery)
  if coalesce(_wallet_amount, 0) > 0 and array_length(_order_ids, 1) > 0 then
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

  -- Wallet/loyalty fully covered (Rs 0 residual): mark paid server-side.
  -- Client updates to payment_status=paid are blocked by trg_guard_order_payment_status.
  if array_length(_order_ids, 1) > 0
     and not exists (
       select 1 from public.orders o
       where o.id = any(_order_ids)
         and round(coalesce(o.total_amount, 0)::numeric, 2) > 0
     )
     and exists (
       select 1 from public.orders o
       where o.id = any(_order_ids)
         and (
           coalesce(o.wallet_cash_amount, 0) + coalesce(o.wallet_promo_amount, 0) > 0
           or coalesce(o.loyalty_discount_amount, 0) > 0
         )
     )
  then
    update public.orders o
    set
      payment_status = 'paid',
      payment_type = case
        when coalesce(o.wallet_cash_amount, 0) + coalesce(o.wallet_promo_amount, 0) > 0 then 'wallet'
        else o.payment_type
      end,
      updated_at = now()
    where o.id = any(_order_ids)
      and o.payment_status is distinct from 'paid';
  end if;

  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;

  return json_build_object(
    'success', true,
    'order_ids', to_json(_order_ids),
    'loyalty', _loyalty_result,
    'wallet', _wallet_result,
    'warnings', json_build_object(
      'closed_sellers', to_json(_closed_sellers),
      'out_of_range', to_json(_out_of_range),
      'payment_blocked', to_json(_payment_blocked_sellers)
    )
  );
end;
$function$;
GRANT EXECUTE ON FUNCTION public.create_multi_vendor_orders(
  uuid, json, text, text, uuid, double precision, double precision, text, text, text,
  numeric, text, numeric, text, uuid[], text, text, integer, numeric
) TO authenticated, service_role;

-- Daily wallet promo expiry (direct SQL; edge process-wallet-expiry remains for manual/ops)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'expire_wallet_lots_daily',
      'process_wallet_expiry_daily'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'expire_wallet_lots_daily',
  '20 0 * * *',
  $cron$ SELECT public.expire_wallet_lots(200); $cron$
);
