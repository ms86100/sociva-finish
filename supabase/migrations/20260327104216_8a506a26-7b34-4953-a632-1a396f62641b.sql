
-- Gap 7: Add _preorder_seller_ids parameter to create_multi_vendor_orders
-- When provided, only orders for sellers in this array get scheduled_date/scheduled_time_start
-- When NULL (default), all orders get the scheduled date (backward compatible)

CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _seller_groups json,
  _delivery_address text DEFAULT '',
  _notes text DEFAULT '',
  _payment_method text DEFAULT 'cod',
  _payment_status text DEFAULT 'pending',
  _cart_total numeric DEFAULT 0,
  _coupon_id text DEFAULT '',
  _coupon_code text DEFAULT '',
  _coupon_discount numeric DEFAULT 0,
  _has_urgent boolean DEFAULT false,
  _delivery_fee numeric DEFAULT 0,
  _fulfillment_type text DEFAULT 'self_pickup',
  _delivery_address_id uuid DEFAULT NULL,
  _delivery_lat double precision DEFAULT NULL,
  _delivery_lng double precision DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _scheduled_date text DEFAULT NULL,
  _scheduled_time_start text DEFAULT NULL,
  _preorder_seller_ids uuid[] DEFAULT NULL
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

  -- First pass: validate all sellers (store open, delivery range)
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
  end loop;

  if array_length(_closed_sellers, 1) > 0 then
    return json_build_object('success', false, 'error', 'store_closed', 'closed_sellers', to_json(_closed_sellers));
  end if;

  if array_length(_out_of_range, 1) > 0 then
    return json_build_object('success', false, 'error', 'delivery_out_of_range', 'out_of_range_sellers', to_json(_out_of_range));
  end if;

  if _payment_method <> 'cod' then
    _auto_cancel_at := now() + interval '3 minutes';
  else
    _auto_cancel_at := NULL;
  end if;

  -- Second pass: create orders
  _group_count := 0;
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

    -- Gap 7: Only apply scheduled_date to pre-order sellers
    -- If _preorder_seller_ids is NULL, apply to all (backward compatible)
    if _preorder_seller_ids is null or _seller_id = ANY(_preorder_seller_ids) then
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;

    insert into public.orders (
      id, buyer_id, seller_id, society_id, status, total_amount,
      payment_type, payment_status, delivery_address, notes,
      order_type, fulfillment_type, delivery_address_id,
      delivery_lat, delivery_lng,
      delivery_fee, discount_amount, coupon_id,
      delivery_handled_by, idempotency_key, auto_cancel_at,
      scheduled_date, scheduled_time_start
    )
    values (
      _order_id, _buyer_id, _seller_id, _society_id, _effective_status::order_status, _total,
      _payment_method, _payment_status, _delivery_address, _notes,
      'purchase', _fulfillment_type, _delivery_address_id,
      _delivery_lat, _delivery_lng,
      _order_delivery_fee, _order_discount,
      CASE WHEN _group_count = 1 THEN _resolved_coupon_id ELSE NULL END,
      _delivery_handled_by, _row_idempotency_key, _auto_cancel_at,
      _effective_scheduled_date, _effective_scheduled_time
    )
    on conflict (buyer_id, idempotency_key) where idempotency_key is not null
    do update set id = orders.id
    returning id into _order_id;

    _order_ids := array_append(_order_ids, _order_id);

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      insert into public.order_items (order_id, product_id, quantity, unit_price)
      values (
        _order_id,
        (_item->>'product_id')::uuid,
        (_item->>'quantity')::int,
        (_item->>'unit_price')::numeric
      );

      update public.products
      set stock_quantity = stock_quantity - (_item->>'quantity')::int
      where id = (_item->>'product_id')::uuid
        and stock_quantity is not null
        and stock_quantity >= (_item->>'quantity')::int;
    end loop;
  end loop;

  if _resolved_coupon_id is not null and _first_order_id is not null then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, discount_applied)
    values (_resolved_coupon_id, _first_order_id, _buyer_id, _coupon_discount);

    update public.coupons set times_used = times_used + 1 where id = _resolved_coupon_id;
  end if;

  delete from public.cart_items where user_id = _buyer_id and society_id = _society_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids), 'order_count', array_length(_order_ids, 1));
end;
$function$;

-- Gap 6: Update notification function to include scheduled date info for sellers
CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer_id       uuid;
  v_seller_id      uuid;
  v_seller_name    text;
  v_buyer_name     text;
  v_order_number   text;
  v_title          text;
  v_body           text;
  v_seller_title   text;
  v_seller_body    text;
  v_silent         boolean := false;
  v_is_terminal    boolean := false;
  v_notify_buyer   boolean := true;
  v_notify_seller  boolean := false;
  v_listing_type   text;
  v_transaction_type text;
  v_parent_group   text;
  v_existing_id    uuid;
  v_product_id     uuid;
  v_seller_user_id uuid;
  v_lookup_group   text;
  v_resolved_group text;
  v_notification_action text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_buyer_id     := NEW.buyer_id;
  v_order_number := LEFT(NEW.id::text, 8);

  SELECT sp.id, sp.business_name, sp.user_id
    INTO v_seller_id, v_seller_name, v_seller_user_id
    FROM public.seller_profiles sp
   WHERE sp.id = NEW.seller_id;

  SELECT COALESCE(p.name, 'Customer')
    INTO v_buyer_name
    FROM public.profiles p
   WHERE p.id = v_buyer_id;

  SELECT oi.product_id INTO v_product_id
    FROM public.order_items oi
   WHERE oi.order_id = NEW.id
   LIMIT 1;

  IF v_product_id IS NOT NULL THEN
    SELECT cc.transaction_type, cc.parent_group
      INTO v_listing_type, v_parent_group
      FROM public.products pr
      JOIN public.category_config cc ON cc.category::text = pr.category
     WHERE pr.id = v_product_id;
  END IF;

  IF NEW.order_type = 'enquiry' THEN
    IF COALESCE(v_parent_group, 'default') IN ('classes', 'events') THEN
      v_transaction_type := 'service_booking';
    ELSE
      v_transaction_type := 'request_service';
    END IF;
  ELSIF NEW.order_type = 'booking' THEN
    v_transaction_type := 'service_booking';
  ELSIF NEW.fulfillment_type = 'self_pickup' THEN
    v_transaction_type := 'self_fulfillment';
  ELSIF NEW.fulfillment_type = 'seller_delivery' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by, 'seller') = 'seller' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN
    v_transaction_type := 'cart_purchase';
  ELSE
    v_transaction_type := 'self_fulfillment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_items WHERE order_id = NEW.id OFFSET 1
  ) AND v_listing_type = 'purchase' THEN
    v_transaction_type := CASE
      WHEN NEW.fulfillment_type IN ('delivery', 'seller_delivery') THEN 'cart_purchase'
      ELSE 'self_fulfillment'
    END;
  END IF;

  v_lookup_group := COALESCE(v_parent_group, 'default');

  SELECT csf.notification_title,
         csf.notification_body,
         csf.seller_notification_title,
         csf.seller_notification_body,
         csf.notify_buyer,
         csf.notify_seller,
         csf.silent_push,
         csf.is_terminal,
         csf.notification_action
    INTO v_title, v_body, v_seller_title, v_seller_body,
         v_notify_buyer, v_notify_seller, v_silent, v_is_terminal,
         v_notification_action
    FROM public.category_status_flows csf
   WHERE csf.status_key = NEW.status::text
     AND csf.transaction_type = v_transaction_type
     AND csf.parent_group = v_lookup_group
   LIMIT 1;

  v_resolved_group := v_lookup_group;

  IF v_title IS NULL AND v_lookup_group <> 'default' THEN
    SELECT csf.notification_title,
           csf.notification_body,
           csf.seller_notification_title,
           csf.seller_notification_body,
           csf.notify_buyer,
           csf.notify_seller,
           csf.silent_push,
           csf.is_terminal,
           csf.notification_action
      INTO v_title, v_body, v_seller_title, v_seller_body,
           v_notify_buyer, v_notify_seller, v_silent, v_is_terminal,
           v_notification_action
      FROM public.category_status_flows csf
     WHERE csf.status_key = NEW.status::text
       AND csf.transaction_type = v_transaction_type
       AND csf.parent_group = 'default'
     LIMIT 1;

    v_resolved_group := 'default';
  END IF;

  IF v_notification_action IS NULL AND v_resolved_group <> 'default' THEN
    SELECT csf.notification_action INTO v_notification_action
      FROM public.category_status_flows csf
     WHERE csf.status_key = NEW.status::text
       AND csf.transaction_type = v_transaction_type
       AND csf.parent_group = 'default'
     LIMIT 1;
  END IF;

  v_notification_action := COALESCE(v_notification_action, 'View Order');

  v_body        := REPLACE(COALESCE(v_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_body        := REPLACE(v_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_body        := REPLACE(v_body, '{order_number}', v_order_number);
  v_seller_body := REPLACE(COALESCE(v_seller_body, ''), '{seller_name}', COALESCE(v_seller_name, 'Seller'));
  v_seller_body := REPLACE(v_seller_body, '{buyer_name}', COALESCE(v_buyer_name, 'Customer'));
  v_seller_body := REPLACE(v_seller_body, '{order_number}', v_order_number);

  -- Gap 6: Append scheduled date info to seller notification body
  IF NEW.scheduled_date IS NOT NULL AND v_seller_body IS NOT NULL AND v_seller_body <> '' THEN
    v_seller_body := v_seller_body || ' 📅 Scheduled: ' || to_char(NEW.scheduled_date, 'DD Mon');
    IF NEW.scheduled_time_start IS NOT NULL THEN
      v_seller_body := v_seller_body || ' at ' || to_char(NEW.scheduled_time_start, 'HH24:MI');
    END IF;
  END IF;

  IF v_notify_buyer AND v_title IS NOT NULL AND v_title <> '' THEN
    SELECT id INTO v_existing_id
      FROM public.notification_queue
     WHERE user_id = v_buyer_id
       AND title = v_title
       AND payload->>'orderId' = NEW.id::text
       AND created_at > NOW() - INTERVAL '30 seconds'
     LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.notification_queue (
        user_id, title, body, type, reference_path, payload
      ) VALUES (
        v_buyer_id,
        v_title,
        v_body,
        'order_status',
        '/orders/' || NEW.id,
        jsonb_build_object(
          'orderId', NEW.id,
          'status', NEW.status::text,
          'action', v_notification_action,
          'type', 'order',
          'is_terminal', v_is_terminal,
          'silent_push', v_silent,
          'seller_name', COALESCE(v_seller_name, 'Seller')
        )
      );
    END IF;
  END IF;

  IF v_notify_seller AND v_seller_user_id IS NOT NULL THEN
    v_seller_title := COALESCE(v_seller_title, v_title, 'Order Update');
    IF v_seller_title IS NOT NULL AND v_seller_title <> '' THEN
      SELECT id INTO v_existing_id
        FROM public.notification_queue
       WHERE user_id = v_seller_user_id
         AND title = v_seller_title
         AND payload->>'orderId' = NEW.id::text
         AND created_at > NOW() - INTERVAL '30 seconds'
       LIMIT 1;

      IF v_existing_id IS NULL THEN
        INSERT INTO public.notification_queue (
          user_id, title, body, type, reference_path, payload
        ) VALUES (
          v_seller_user_id,
          v_seller_title,
          COALESCE(NULLIF(v_seller_body, ''), v_body, ''),
          'order_status',
          '/orders/' || NEW.id,
          jsonb_build_object(
            'orderId', NEW.id,
            'status', NEW.status::text,
            'action', 'View Order',
            'type', 'order',
            'is_terminal', v_is_terminal,
            'buyer_name', COALESCE(v_buyer_name, 'Customer'),
            'scheduled_date', NEW.scheduled_date,
            'scheduled_time_start', NEW.scheduled_time_start
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
