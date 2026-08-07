-- ============================================================
-- Phase 1 loyalty (part 2): wire checkout, settlement, earn, clawbacks
-- Depends on: 20260807120000_loyalty_phase1_platform_funded.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Replace create_multi_vendor_orders with loyalty-aware version
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(
  uuid, json, text, text, uuid, double precision, double precision, text, text, text,
  numeric, text, numeric, text, uuid[], text, text
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
  _loyalty_points integer DEFAULT 0
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
      _config_accepts_online := coalesce((_seller_payment_config->>'accepts_online')::boolean, true);
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

  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;

  return json_build_object(
    'success', true,
    'order_ids', to_json(_order_ids),
    'loyalty', _loyalty_result,
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
  numeric, text, numeric, text, uuid[], text, text, integer
) TO authenticated, service_role;

-- Drop legacy overload that accepted _cart_total/_coupon_code/_has_urgent (PostgREST ambiguity)
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(
  uuid, json, text, text, text, text, numeric, text, text, numeric, boolean, numeric, text, uuid, double precision, double precision, text, text, text, uuid[]
);

-- ------------------------------------------------------------
-- 2. Settlement: sellers get pre-loyalty gross; platform subsidy explicit
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
  -- Platform-funded: seller GMV is pre-loyalty; buyer paid total_amount
  _gross_before := COALESCE(p_new.total_amount, 0) + _loyalty_subsidy;
  _gross := _gross_before;
  _net := _gross - _platform_fee;

  SELECT society_id INTO _society_id FROM public.profiles WHERE id = p_new.buyer_id;

  INSERT INTO public.seller_settlements (
    order_id, seller_id, society_id,
    gross_amount, platform_fee, delivery_fee_share, net_amount,
    platform_loyalty_subsidy, gross_before_loyalty,
    settlement_status, eligible_at
  ) VALUES (
    p_new.id, p_new.seller_id, COALESCE(_society_id, p_new.buyer_society_id),
    _gross, _platform_fee, COALESCE(p_new.delivery_fee, 0), _net,
    _loyalty_subsidy, _gross_before,
    'pending',
    now() + (_cooldown_hours || ' hours')::interval
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. Earn on delivery -> wallet + ledger (idempotent)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_earn_loyalty_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _points integer;
  _already boolean;
  _idem text;
BEGIN
  IF NEW.status IN ('delivered', 'completed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    _idem := 'earn:order:' || NEW.id::text;

    SELECT EXISTS(
      SELECT 1 FROM public.loyalty_ledger
      WHERE idempotency_key = _idem
         OR (order_id = NEW.id AND entry_type = 'earn')
    ) INTO _already;

    IF NOT _already THEN
      SELECT EXISTS(
        SELECT 1 FROM public.loyalty_points
        WHERE reference_id = NEW.id::text AND source = 'order' AND type = 'earned'
      ) INTO _already;
    END IF;

    IF NOT _already AND COALESCE(NEW.total_amount, 0) > 0 THEN
      -- Earn on post-loyalty paid amount (conservative)
      _points := GREATEST(FLOOR(NEW.total_amount / 10)::integer, 1);

      PERFORM public.loyalty_ensure_wallet(NEW.buyer_id);

      UPDATE public.loyalty_wallets
      SET
        available_points = available_points + _points,
        lifetime_earned = lifetime_earned + _points,
        updated_at = now()
      WHERE user_id = NEW.buyer_id;

      INSERT INTO public.loyalty_ledger (
        user_id, entry_type, points, funding_source, store_id, order_id,
        reference_id, description, metadata, idempotency_key
      ) VALUES (
        NEW.buyer_id, 'earn', _points, 'platform', NEW.seller_id, NEW.id,
        NEW.id::text,
        'Earned ' || _points || ' points on order',
        jsonb_build_object('legacy_source', 'order', 'rate', '1_per_10'),
        _idem
      );

      -- Keep legacy table in sync for any old readers
      INSERT INTO public.loyalty_points (user_id, points, type, source, reference_id, description)
      VALUES (NEW.buyer_id, _points, 'earned', 'order', NEW.id::text,
        'Earned ' || _points || ' points on order');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_earn_loyalty_on_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _already boolean;
  _idem text := 'earn:review:' || NEW.id::text;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.loyalty_ledger WHERE idempotency_key = _idem
  ) INTO _already;

  IF NOT _already THEN
    SELECT EXISTS(
      SELECT 1 FROM public.loyalty_points WHERE reference_id = NEW.id::text AND source = 'review'
    ) INTO _already;
  END IF;

  IF NOT _already THEN
    PERFORM public.loyalty_ensure_wallet(NEW.buyer_id);

    UPDATE public.loyalty_wallets
    SET
      available_points = available_points + 10,
      lifetime_earned = lifetime_earned + 10,
      updated_at = now()
    WHERE user_id = NEW.buyer_id;

    INSERT INTO public.loyalty_ledger (
      user_id, entry_type, points, funding_source, reference_id, description, metadata, idempotency_key
    ) VALUES (
      NEW.buyer_id, 'earn', 10, 'platform', NEW.id::text,
      '+10 points for writing a review',
      jsonb_build_object('legacy_source', 'review'),
      _idem
    );

    INSERT INTO public.loyalty_points (user_id, points, type, source, reference_id, description)
    VALUES (NEW.buyer_id, 10, 'bonus', 'review', NEW.id::text, '+10 points for writing a review');
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 4. Cancel / unpaid failure -> release hold or restore redeemed
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_loyalty_on_order_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.loyalty_reservations;
  _siblings_open integer;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.loyalty_reservation_id IS NOT NULL THEN
      SELECT * INTO r
      FROM public.loyalty_reservations
      WHERE id = NEW.loyalty_reservation_id
      FOR UPDATE;

      IF FOUND AND r.status = 'held' THEN
        SELECT COUNT(*) INTO _siblings_open
        FROM public.orders
        WHERE loyalty_reservation_id = r.id
          AND id IS DISTINCT FROM NEW.id
          AND status IS DISTINCT FROM 'cancelled';

        IF COALESCE(_siblings_open, 0) = 0 THEN
          PERFORM public.release_loyalty_reservation(r.id);
        END IF;
      ELSIF FOUND AND r.status = 'committed' AND COALESCE(NEW.loyalty_points_redeemed, 0) > 0 THEN
        -- Full cancel before/without needing delivery: restore this order's redeemed points
        PERFORM public.restore_loyalty_for_order(NEW.id, NEW.loyalty_points_redeemed, 'cancel');
      END IF;
    ELSIF COALESCE(NEW.loyalty_points_redeemed, 0) > 0 THEN
      PERFORM public.restore_loyalty_for_order(NEW.id, NEW.loyalty_points_redeemed, 'cancel');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loyalty_on_order_cancelled ON public.orders;
CREATE TRIGGER trg_loyalty_on_order_cancelled
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_loyalty_on_order_cancelled();

-- ------------------------------------------------------------
-- 5. complete_refund -> proportional reverse earn + restore redeem
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

  -- Loyalty clawback (platform-funded policy):
  -- - Reverse earned points proportional to refund_amount / paid total
  -- - Restore redeemed points proportional to same fraction
  SELECT * INTO o FROM public.orders WHERE id = r.order_id;
  IF FOUND THEN
    _paid := NULLIF(COALESCE(o.total_amount, 0), 0);
    IF _paid IS NOT NULL AND COALESCE(r.amount, 0) > 0 THEN
      _frac := LEAST(GREATEST(r.amount / _paid, 0), 1);
    ELSE
      _frac := 1;
    END IF;

    PERFORM public.reverse_loyalty_earn_for_order(o.id, _frac);

    _restore := FLOOR(COALESCE(o.loyalty_points_redeemed, 0) * _frac)::integer;
    IF _restore > 0 THEN
      PERFORM public.restore_loyalty_for_order(o.id, _restore, 'refund');
    END IF;
  END IF;

  INSERT INTO public.refund_audit_log(refund_id, action, actor_role, before_state, after_state, metadata)
  VALUES (p_refund_id, 'complete', 'system', v_before, 'refund_completed',
          jsonb_build_object('gateway_ref', p_gateway_ref, 'gateway_status', p_gateway_status));

  INSERT INTO public.notification_queue(user_id, title, body, type, reference_path, payload)
  VALUES (r.buyer_id,
          'Refund completed',
          'Your refund of INR ' || r.amount || ' has been settled to your original payment method. Ref: ' || p_gateway_ref,
          'order',
          '/orders/' || r.order_id,
          jsonb_build_object('orderId', r.order_id, 'refundId', r.id, 'status', 'refund_completed', 'target_role', 'buyer'));

  RETURN r;
END;
$function$;

-- ------------------------------------------------------------
-- 6. Commit helper for edge functions (service role)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_loyalty_for_orders(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res_id uuid;
  _buyer uuid;
BEGIN
  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  SELECT loyalty_reservation_id, buyer_id
  INTO _res_id, _buyer
  FROM public.orders
  WHERE id = ANY(_order_ids)
    AND loyalty_reservation_id IS NOT NULL
  LIMIT 1;

  IF _res_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  RETURN public.commit_loyalty_reservation(_res_id, _order_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_loyalty_for_orders(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res_id uuid;
BEGIN
  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  SELECT loyalty_reservation_id INTO _res_id
  FROM public.orders
  WHERE id = ANY(_order_ids)
    AND loyalty_reservation_id IS NOT NULL
  LIMIT 1;

  IF _res_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  RETURN public.release_loyalty_reservation(_res_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_loyalty_wallet() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.quote_loyalty_redemption(numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_loyalty_points(integer, text, text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_loyalty_reservation(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_loyalty_reservation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_loyalty_for_orders(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_loyalty_for_orders(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_loyalty_liability() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_loyalty_to_checkout_orders(uuid, uuid[], integer, text, text) TO service_role;

-- Legacy redeem RPC: block unsafe path; point clients to checkout flow
CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(
  _points integer,
  _order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'deprecated',
    'message', 'Loyalty redemption is applied server-side during checkout. Use quote_loyalty_redemption and create_multi_vendor_orders(_loyalty_points).'
  );
END;
$$;

-- Account wipe: also clear new loyalty tables
CREATE OR REPLACE FUNCTION public._loyalty_account_wipe(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.loyalty_reservations WHERE user_id = _user_id;
  DELETE FROM public.loyalty_ledger WHERE user_id = _user_id;
  DELETE FROM public.loyalty_wallets WHERE user_id = _user_id;
  DELETE FROM public.loyalty_points WHERE user_id = _user_id;
END;
$$;
