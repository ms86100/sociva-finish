-- Ship readiness: seller silent-failure fixes
-- C1 Double stock decrement + silent insufficient stock
-- C2 Stock never restored on cancel
-- C3 Buyer/seller payment_status forgery
-- C4 Seller self-approve verification / products / licenses
-- C5 Refund state machine client forge to completed

-- ============================================================
-- C1: Remove dual decrement path (trigger + RPC)
-- ============================================================
DROP TRIGGER IF EXISTS trg_decrement_stock_on_order_item ON public.order_items;

CREATE OR REPLACE FUNCTION public.decrement_stock_on_order_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Intentionally no-op: stock is decremented only in create_multi_vendor_orders
  RETURN NEW;
END;
$$;

-- ============================================================
-- C1b: create_multi_vendor_orders — fail hard if stock update misses
-- ============================================================
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
  _scheduled_time_start text DEFAULT NULL
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
          COALESCE(_product_row.name, _product_id::text) || ' (was ₹' || _client_price || ', now ₹' || _product_row.price || ')'
        );
      end if;
    end loop;
  end loop;

  if array_length(_unavailable_items, 1) > 0 then
    return json_build_object(
      'success', false,
      'error', 'unavailable_items',
      'items', to_json(_unavailable_items)
    );
  end if;

  if array_length(_non_cart_items, 1) > 0 then
    return json_build_object(
      'success', false,
      'error', 'non_cart_items',
      'items', to_json(_non_cart_items),
      'message', 'Some items cannot be ordered via cart'
    );
  end if;

  if array_length(_stock_insufficient, 1) > 0 then
    return json_build_object(
      'success', false,
      'error', 'insufficient_stock',
      'items', to_json(_stock_insufficient)
    );
  end if;

  if array_length(_price_changed_items, 1) > 0 then
    return json_build_object(
      'success', false,
      'error', 'price_changed',
      'items', to_json(_price_changed_items)
    );
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

  -- Single atomic stock decrement path (trigger removed). Fail hard on miss.
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
    return json_build_object(
      'success', false,
      'error', 'sellers_closed',
      'sellers', to_json(_closed_sellers)
    );
  end if;

  if array_length(_out_of_range, 1) > 0 and array_length(_order_ids, 1) = 0 then
    return json_build_object(
      'success', false,
      'error', 'out_of_range',
      'sellers', to_json(_out_of_range)
    );
  end if;

  if array_length(_payment_blocked_sellers, 1) > 0 and array_length(_order_ids, 1) = 0 then
    return json_build_object(
      'success', false,
      'error', 'payment_method_not_accepted',
      'sellers', to_json(_payment_blocked_sellers),
      'message', 'Selected payment method is not accepted by: ' || array_to_string(_payment_blocked_sellers, ', ')
    );
  end if;

  delete from public.cart_items
  where user_id = _buyer_id
    and society_id = _society_id;

  return json_build_object(
    'success', true,
    'order_ids', to_json(_order_ids),
    'warnings', json_build_object(
      'closed_sellers', to_json(_closed_sellers),
      'out_of_range', to_json(_out_of_range),
      'payment_blocked', to_json(_payment_blocked_sellers)
    )
  );
end;
$function$;

-- ============================================================
-- C2: Restore stock on cancel (impl + live trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
BEGIN
  IF p_new.status = 'cancelled'::public.order_status
     AND p_old.status IS DISTINCT FROM 'cancelled'::public.order_status THEN
    UPDATE public.products p
    SET
      stock_quantity = p.stock_quantity + oi.quantity,
      is_available = CASE
        WHEN p.stock_quantity + oi.quantity > 0 THEN true
        ELSE p.is_available
      END
    FROM public.order_items oi
    WHERE oi.order_id = p_new.id
      AND oi.product_id = p.id
      AND p.stock_quantity IS NOT NULL;
  END IF;
END;
$f$;

CREATE OR REPLACE FUNCTION public.restore_stock_on_order_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.restore_stock_on_cancel_impl(OLD, NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restore_stock_on_order_cancel ON public.orders;
DROP TRIGGER IF EXISTS trg_restore_stock_on_cancel ON public.orders;
CREATE TRIGGER trg_restore_stock_on_order_cancel
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.restore_stock_on_order_cancel();

-- ============================================================
-- C3: Lock payment_records updates to admin / SECURITY DEFINER
-- ============================================================
DROP POLICY IF EXISTS "System can update payment records" ON public.payment_records;
CREATE POLICY "Admins can update payment records"
ON public.payment_records FOR UPDATE
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- Block direct client forgery of orders.payment_status → paid/refunded.
-- SECURITY DEFINER RPCs run as function owner (not 'authenticated'), so they pass.
CREATE OR REPLACE FUNCTION public.guard_order_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status IN ('paid', 'refunded')
       AND current_user IN ('authenticated', 'anon')
       AND NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Direct payment_status changes to % are not allowed', NEW.payment_status
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_order_payment_status ON public.orders;
CREATE TRIGGER trg_guard_order_payment_status
  BEFORE UPDATE OF payment_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_order_payment_status();

-- ============================================================
-- C4: Block seller self-approval of store / products / licenses
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_seller_verification_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Block store owners from self-approving. Admins / society admins (not the owner) may approve.
  IF NEW.verification_status = 'approved'
     AND OLD.verification_status IS DISTINCT FROM 'approved'
     AND current_user IN ('authenticated', 'anon')
     AND NEW.user_id = auth.uid()
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sellers cannot self-approve their store'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_seller_verification_status ON public.seller_profiles;
CREATE TRIGGER trg_guard_seller_verification_status
  BEFORE UPDATE OF verification_status ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_seller_verification_status();

CREATE OR REPLACE FUNCTION public.guard_product_approval_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approval_status = 'approved'
     AND OLD.approval_status IS DISTINCT FROM 'approved'
     AND current_user IN ('authenticated', 'anon')
     AND NOT public.is_admin(auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.seller_profiles sp
       WHERE sp.id = NEW.seller_id AND sp.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Sellers cannot self-approve products'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_product_approval_status ON public.products;
CREATE TRIGGER trg_guard_product_approval_status
  BEFORE UPDATE OF approval_status ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_product_approval_status();

CREATE OR REPLACE FUNCTION public.guard_seller_license_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND current_user IN ('authenticated', 'anon')
     AND NOT public.is_admin(auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.seller_profiles sp
       WHERE sp.id = NEW.seller_id AND sp.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'Sellers cannot self-approve or self-reject licenses'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_seller_license_status ON public.seller_licenses;
CREATE TRIGGER trg_guard_seller_license_status
  BEFORE UPDATE OF status ON public.seller_licenses
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_seller_license_status();

-- ============================================================
-- C5: Block sellers from forging refund_completed via client UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_refund_terminal_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.refund_state IS DISTINCT FROM OLD.refund_state THEN
    IF current_user IN ('authenticated', 'anon')
       AND NOT public.is_admin(auth.uid()) THEN
      IF NEW.refund_state IN ('refund_initiated', 'refund_processing', 'refund_completed') THEN
        RAISE EXCEPTION 'Refund gateway states require privileged path'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_refund_terminal_state ON public.refund_requests;
CREATE TRIGGER trg_guard_refund_terminal_state
  BEFORE UPDATE OF refund_state ON public.refund_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_refund_terminal_state();
