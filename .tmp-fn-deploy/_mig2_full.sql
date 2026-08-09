-- ============================================================
-- Sociva Credit MVP (part 2): wire checkout, settlement, refunds
-- Depends on: 20260807120312_wallet_mvp_sociva_credit.sql
-- ============================================================

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

-- ------------------------------------------------------------
-- Settlement: seller GMV includes wallet-applied amounts
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cooldown_hours integer;
  _platform_fee numeric;
  _gross numeric;
  _net numeric;
  _society_id uuid;
  _loyalty_subsidy numeric;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _gross_before numeric;
BEGIN
  IF p_old.status IS NOT DISTINCT FROM p_new.status THEN RETURN; END IF;
  IF p_new.status NOT IN ('delivered', 'completed') THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.seller_settlements WHERE order_id = p_new.id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(value::integer, 48) INTO _cooldown_hours
  FROM public.system_settings WHERE key = 'settlement_cooldown_hours';
  IF _cooldown_hours IS NULL THEN _cooldown_hours := 48; END IF;

  SELECT COALESCE(pr.platform_fee, 0) INTO _platform_fee
  FROM public.payment_records pr WHERE pr.order_id = p_new.id LIMIT 1;
  IF _platform_fee IS NULL THEN _platform_fee := 0; END IF;

  _loyalty_subsidy := COALESCE(p_new.loyalty_discount_amount, 0);
  _wallet_cash := COALESCE(p_new.wallet_cash_amount, 0);
  _wallet_promo := COALESCE(p_new.wallet_promo_amount, 0);
  -- Seller GMV = what buyer would have paid without loyalty/wallet credits
  _gross_before := COALESCE(p_new.total_amount, 0) + _loyalty_subsidy + _wallet_cash + _wallet_promo;
  _gross := _gross_before;
  _net := _gross - _platform_fee;

  SELECT society_id INTO _society_id FROM public.profiles WHERE id = p_new.buyer_id;

  INSERT INTO public.seller_settlements (
    order_id, seller_id, society_id,
    gross_amount, platform_fee, delivery_fee_share, net_amount,
    platform_loyalty_subsidy, gross_before_loyalty,
    wallet_cash_applied, wallet_promo_applied,
    settlement_status, eligible_at
  ) VALUES (
    p_new.id, p_new.seller_id, COALESCE(_society_id, p_new.buyer_society_id),
    _gross, _platform_fee, COALESCE(p_new.delivery_fee, 0), _net,
    _loyalty_subsidy, COALESCE(p_new.total_amount, 0) + _loyalty_subsidy,
    _wallet_cash, _wallet_promo,
    'pending',
    now() + (_cooldown_hours || ' hours')::interval
  );
END;
$$;

-- ------------------------------------------------------------
-- Cancel: release wallet hold or restore committed spend
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_wallet_on_order_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.wallet_reservations;
  _siblings_open integer;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.wallet_reservation_id IS NOT NULL THEN
      SELECT * INTO r
      FROM public.wallet_reservations
      WHERE id = NEW.wallet_reservation_id
      FOR UPDATE;

      IF FOUND AND r.status = 'held' THEN
        SELECT COUNT(*) INTO _siblings_open
        FROM public.orders
        WHERE wallet_reservation_id = r.id
          AND id IS DISTINCT FROM NEW.id
          AND status IS DISTINCT FROM 'cancelled';

        IF COALESCE(_siblings_open, 0) = 0 THEN
          PERFORM public.release_wallet_reservation(r.id);
        END IF;
      ELSIF FOUND AND r.status = 'committed'
            AND (COALESCE(NEW.wallet_cash_amount, 0) > 0 OR COALESCE(NEW.wallet_promo_amount, 0) > 0) THEN
        PERFORM public.restore_wallet_for_order(
          NEW.id, NEW.wallet_cash_amount, NEW.wallet_promo_amount, 'cancel'
        );
      END IF;
    ELSIF COALESCE(NEW.wallet_cash_amount, 0) > 0 OR COALESCE(NEW.wallet_promo_amount, 0) > 0 THEN
      PERFORM public.restore_wallet_for_order(
        NEW.id, NEW.wallet_cash_amount, NEW.wallet_promo_amount, 'cancel'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_on_order_cancelled ON public.orders;
CREATE TRIGGER trg_wallet_on_order_cancelled
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_wallet_on_order_cancelled();

-- ------------------------------------------------------------
-- request_refund: optional Sociva Credit destination
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.request_refund(uuid, text, text, text[]);

CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_refund_destination text DEFAULT 'original_payment'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_seller_user uuid;
  v_dest text;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  v_dest := lower(COALESCE(NULLIF(trim(p_refund_destination), ''), 'original_payment'));
  IF v_dest NOT IN ('original_payment', 'wallet') THEN
    RAISE EXCEPTION 'Invalid refund destination: %', v_dest;
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status,
         payment_type, wallet_cash_amount, wallet_promo_amount
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  IF EXISTS (SELECT 1 FROM refund_requests WHERE order_id = p_order_id AND status NOT IN ('rejected', 'completed')) THEN
    RAISE EXCEPTION 'A refund request already exists for this order';
  END IF;

  -- COD / wallet-only: prefer wallet credit when destination not forced to original
  IF v_dest = 'original_payment'
     AND lower(COALESCE(v_order.payment_type, '')) IN ('cod', 'cash') THEN
    v_dest := 'wallet';
  END IF;

  -- Refundable = residual paid (gateway/COD) + wallet applied on this order
  -- (frozen_total wins when set; else reconstruct buyer economic outlay)
  INSERT INTO refund_requests (
    order_id, buyer_id, seller_id, society_id, amount, reason, category,
    evidence_urls, refund_method, refund_destination, wallet_credit_amount
  )
  VALUES (
    p_order_id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.society_id,
    COALESCE(
      NULLIF(v_order.frozen_total, 0),
      COALESCE(v_order.total_amount, 0)
        + COALESCE(v_order.wallet_cash_amount, 0)
        + COALESCE(v_order.wallet_promo_amount, 0)
    ),
    p_reason,
    p_category,
    p_evidence_urls,
    CASE WHEN v_dest = 'wallet' THEN 'wallet' ELSE 'original_payment' END,
    v_dest,
    CASE WHEN v_dest = 'wallet' THEN COALESCE(
      NULLIF(v_order.frozen_total, 0),
      COALESCE(v_order.total_amount, 0)
        + COALESCE(v_order.wallet_cash_amount, 0)
        + COALESCE(v_order.wallet_promo_amount, 0)
    ) ELSE NULL END
  )
  RETURNING id INTO v_refund_id;

  IF NOT EXISTS (SELECT 1 FROM dispute_tickets WHERE order_id = p_order_id AND status != 'resolved') THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (p_order_id, auth.uid(), v_order.seller_id, p_reason, p_category, 'open', v_order.society_id);
  END IF;

  SELECT sp.user_id INTO v_seller_user
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user IS NOT NULL THEN
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      v_seller_user,
      'Refund requested',
      'A buyer requested a refund. Reason: ' || left(coalesce(p_reason, ''), 120),
      'order',
      '/orders/' || p_order_id,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'wa_template', 'sociva_refund_update',
        'refund_destination', v_dest
      )
    );
  END IF;

  RETURN v_refund_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_refund(uuid, text, text, text[], text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- complete_refund: loyalty clawback + wallet restore + optional wallet credit msg
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_refund(p_refund_id uuid, p_gateway_ref text, p_gateway_status text)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.refund_requests;
  v_before text;
  o public.orders;
  _paid numeric;
  _frac numeric;
  _restore integer;
  _wallet_cash numeric;
  _wallet_promo numeric;
  _notify_body text;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;
  v_before := r.refund_state;
  IF r.refund_state NOT IN ('refund_initiated','refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be completed from state: %', r.refund_state;
  END IF;

  UPDATE public.payment_ledger
  SET status = 'success',
      reference_id = p_gateway_ref,
      gateway_response = jsonb_build_object('status', p_gateway_status),
      updated_at = now()
  WHERE refund_id = p_refund_id AND status = 'pending';

  UPDATE public.refund_requests
  SET refund_state = 'refund_completed',
      status = 'settled',
      settled_at = now(),
      gateway_refund_id = p_gateway_ref,
      gateway_status = p_gateway_status,
      updated_at = now()
  WHERE id = p_refund_id
  RETURNING * INTO r;

  UPDATE public.orders
  SET payment_status = 'refunded',
      updated_at = now()
  WHERE id = r.order_id
    AND payment_status = 'paid';

  UPDATE public.payment_records
  SET payment_status = 'refunded'
  WHERE order_id = r.order_id
    AND payment_status = 'paid';

  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
    _paid := NULLIF(COALESCE(o.total_amount, 0) + COALESCE(o.wallet_cash_amount, 0) + COALESCE(o.wallet_promo_amount, 0) + COALESCE(o.loyalty_discount_amount, 0), 0);
    -- Prefer paid residual for fraction; fall back to refund vs merchandise+credits
    IF COALESCE(o.total_amount, 0) > 0 THEN
      _paid := o.total_amount;
    END IF;
    IF _paid IS NOT NULL AND COALESCE(r.amount, 0) > 0 THEN
      _frac := LEAST(GREATEST(r.amount / NULLIF(_paid, 0), 0), 1);
    ELSE
      _frac := 1;
    END IF;

    PERFORM public.reverse_loyalty_earn_for_order(o.id, _frac);

    _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
    IF _restore > 0 THEN
      PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
    END IF;

    -- Restore wallet spend proportionally (skip when destination=wallet;
    -- credit_wallet_from_refund already covers the full economic refund)
    IF COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
      _wallet_cash := ROUND(COALESCE(o.wallet_cash_amount, 0) * _frac, 2);
      _wallet_promo := ROUND(COALESCE(o.wallet_promo_amount, 0) * _frac, 2);
      IF _wallet_cash > 0 OR _wallet_promo > 0 THEN
        PERFORM public.restore_wallet_for_order(o.id, _wallet_cash, _wallet_promo, 'refund');
      END IF;
    END IF;
  END IF;

  IF COALESCE(r.refund_destination, 'original_payment') = 'wallet' THEN
    _notify_body := 'Your refund of INR ' || r.amount || ' was credited instantly as Sociva Credit. Usable on Sociva only (not withdrawable). Ref: ' || p_gateway_ref;
  ELSE
    _notify_body := 'Your refund of INR ' || r.amount || ' has been settled to your original payment method. Ref: ' || p_gateway_ref;
  END IF;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object(
            'gateway_ref', p_gateway_ref,
            'gateway_status', p_gateway_status,
            'refund_destination', r.refund_destination
          ));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          _notify_body,
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object(
            'orderId', r.order_id,
            'refundId', r.id,
            'status', 'refund_completed',
            'target_role', 'buyer',
            'refund_destination', r.refund_destination
          ));

  RETURN r;
END;
$function$;

-- Wallet-path helper used by refund-processor (skip Razorpay)
CREATE OR REPLACE FUNCTION public.complete_wallet_refund(p_refund_id uuid)
RETURNS refund_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.refund_requests;
  _credit jsonb;
BEGIN
  SELECT * INTO r FROM public.refund_requests WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund not found'; END IF;

  IF r.refund_state = 'refund_completed' THEN
    RETURN r;
  END IF;

  IF r.refund_state <> 'approved' AND r.refund_state NOT IN ('refund_initiated', 'refund_processing') THEN
    RAISE EXCEPTION 'Refund cannot be wallet-completed from state: %', r.refund_state;
  END IF;

  IF COALESCE(r.refund_destination, 'original_payment') <> 'wallet' THEN
    RAISE EXCEPTION 'Refund destination is not wallet';
  END IF;

  -- Move to initiated if still approved
  IF r.refund_state = 'approved' THEN
    UPDATE public.refund_requests
    SET refund_state = 'refund_initiated',
        status = 'processing',
        processed_at = now(),
        updated_at = now()
    WHERE id = p_refund_id
    RETURNING * INTO r;
  END IF;

  _credit := public.credit_wallet_from_refund(p_refund_id);
  IF COALESCE((_credit->>'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'wallet credit failed: %', coalesce(_credit->>'error', 'unknown');
  END IF;

  RETURN public.complete_refund(
    p_refund_id,
    COALESCE(_credit->>'txn_id', 'wallet_' || p_refund_id::text),
    'wallet_credited'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_wallet_refund(uuid) TO service_role;