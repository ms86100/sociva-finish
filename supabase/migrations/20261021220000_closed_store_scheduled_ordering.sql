-- Closed-store scheduled ordering: slot validation, cart exemption, CMVO hours check,
-- and scheduled label on the existing seller new-order push.

CREATE OR REPLACE FUNCTION public.store_operating_on(p_days text[], p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_days IS NULL
      OR coalesce(array_length(p_days, 1), 0) = 0
      OR EXISTS (
        SELECT 1
        FROM unnest(p_days) AS d
        WHERE lower(left(btrim(d), 3)) = lower(to_char(p_date, 'Dy'))
           OR (btrim(d) ~ '^\d+$' AND btrim(d)::int = EXTRACT(DOW FROM p_date)::int)
      );
$$;

CREATE OR REPLACE FUNCTION public.store_scheduled_slot_is_valid(
  p_start time,
  p_end time,
  p_days text[],
  p_available boolean,
  p_vacation boolean,
  p_prep_minutes integer,
  p_lead_minutes integer,
  p_scheduled_date date,
  p_scheduled_time time
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_slot_ts timestamptz;
  v_start_m int;
  v_raw_end int;
  v_end_m int;
  v_slot_m int;
  v_prep int;
  v_lead int;
  v_earliest int;
  v_overnight boolean;
BEGIN
  IF coalesce(p_vacation, false) OR p_available = false THEN
    RETURN false;
  END IF;
  IF p_scheduled_date IS NULL OR p_scheduled_time IS NULL THEN
    RETURN false;
  END IF;

  v_slot_ts := (p_scheduled_date + p_scheduled_time) AT TIME ZONE 'Asia/Kolkata';
  v_prep := GREATEST(COALESCE(p_prep_minutes, 15), 15);
  v_lead := GREATEST(COALESCE(p_lead_minutes, 0), 0);
  IF v_slot_ts <= now() + make_interval(mins => v_lead) THEN
    RETURN false;
  END IF;
  IF (EXTRACT(MINUTE FROM p_scheduled_time)::int % 15) <> 0 THEN
    RETURN false;
  END IF;

  v_slot_m := EXTRACT(HOUR FROM p_scheduled_time)::int * 60 + EXTRACT(MINUTE FROM p_scheduled_time)::int;

  IF p_start IS NULL OR p_end IS NULL THEN
    RETURN v_slot_ts >= now() + make_interval(mins => v_prep + v_lead);
  END IF;

  v_start_m := EXTRACT(HOUR FROM p_start)::int * 60 + EXTRACT(MINUTE FROM p_start)::int;
  v_raw_end := EXTRACT(HOUR FROM p_end)::int * 60 + EXTRACT(MINUTE FROM p_end)::int;
  v_end_m := CASE WHEN v_raw_end = 0 THEN 1440 ELSE v_raw_end END;
  v_overnight := v_end_m <= v_start_m;
  v_earliest := CEIL((v_start_m + v_prep)::numeric / 15) * 15;

  IF v_overnight THEN
    IF v_slot_m >= v_earliest THEN
      RETURN public.store_operating_on(p_days, p_scheduled_date);
    ELSIF v_slot_m < v_end_m THEN
      RETURN public.store_operating_on(p_days, p_scheduled_date - 1);
    END IF;
    RETURN false;
  END IF;

  RETURN public.store_operating_on(p_days, p_scheduled_date)
     AND v_slot_m >= v_earliest
     AND v_slot_m < v_end_m;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_scheduled_slot_is_valid(
  p_seller_id uuid,
  p_scheduled_date date,
  p_scheduled_time time,
  p_prep_minutes integer DEFAULT 15,
  p_lead_minutes integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_start time;
  v_end time;
  v_days text[];
  v_available boolean;
  v_vacation boolean;
BEGIN
  SELECT sp.availability_start, sp.availability_end, sp.operating_days,
         coalesce(sp.is_available, true), coalesce(sp.vacation_mode, false)
    INTO v_start, v_end, v_days, v_available, v_vacation
  FROM public.seller_profiles sp
  WHERE sp.id = p_seller_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  RETURN public.store_scheduled_slot_is_valid(
    v_start, v_end, v_days, v_available, v_vacation,
    p_prep_minutes, p_lead_minutes, p_scheduled_date, p_scheduled_time
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_cart_item_store_availability() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_seller_id uuid;
  v_status jsonb;
  v_status_text text;
  v_vacation boolean;
begin
  select p.seller_id
    into v_seller_id
  from public.products p
  where p.id = new.product_id
    and p.is_available = true
    and p.approval_status = 'approved';

  if v_seller_id is null then
    raise exception 'PRODUCT_NOT_ORDERABLE' using errcode = 'P0001';
  end if;

  select public.compute_store_status(
    sp.availability_start,
    sp.availability_end,
    sp.operating_days,
    coalesce(sp.is_available, true)
  ),
  coalesce(sp.vacation_mode, false)
  into v_status, v_vacation
  from public.seller_profiles sp
  where sp.id = v_seller_id;

  if v_status is null then
    raise exception 'SELLER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_status_text := coalesce(v_status->>'status', 'closed');
  if v_vacation then
    raise exception 'STORE_CLOSED:vacation' using errcode = 'P0001';
  end if;
  if v_status_text = 'paused' then
    raise exception 'STORE_CLOSED:%', v_status_text using errcode = 'P0001';
  end if;
  -- closed / closed_today may add for a future scheduled order

  return new;
end;
$$;

DO $mig$
DECLARE
  src text;
  oid oid;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO oid, src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF src IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  IF position('seller_scheduled_slot_is_valid' in src) > 0 THEN
    RAISE NOTICE 'create_multi_vendor_orders already validates scheduled slots';
    RETURN;
  END IF;

  IF position($a$_closed_sellers text[] := '{}';$a$ in src) = 0 THEN
    RAISE EXCEPTION 'closed_sellers declare anchor not found on create_multi_vendor_orders';
  END IF;
  src := replace(src,
    $a$_closed_sellers text[] := '{}';$a$,
    $b$_closed_sellers text[] := '{}';
  _seller_vacation boolean := false;
  _prep_minutes int := 15;
  _lead_minutes int := 0;
  _must_schedule boolean := false;$b$);

  IF position('public.compute_store_status(sp.availability_start, sp.availability_end, sp.manual_override, sp.manual_override_until)' in src) = 0 THEN
    RAISE EXCEPTION 'compute_store_status hours overload anchor not found on create_multi_vendor_orders';
  END IF;
  src := replace(src,
    'public.compute_store_status(sp.availability_start, sp.availability_end, sp.manual_override, sp.manual_override_until)',
    'public.compute_store_status(sp.availability_start, sp.availability_end, sp.operating_days, coalesce(sp.is_available, true))');

  IF position('and not (_preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids)) then' in src) = 0 THEN
    RAISE EXCEPTION 'preorder bypass skip anchor not found on create_multi_vendor_orders';
  END IF;
  src := replace(src,
$old$    if _seller_status_text is not null
       and _seller_status_text not in ('open', 'accepting_preorders')
       and not (_preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids)) then
      _closed_sellers := array_append(_closed_sellers, COALESCE(_seller_name, _seller_id::text));
      continue;
    end if;$old$,
$new$    _seller_vacation := coalesce((select sp.vacation_mode from public.seller_profiles sp where sp.id = _seller_id), false);
    select coalesce(max(greatest(coalesce(p.prep_time_minutes, 15), 15)), 15),
           coalesce(max(case when coalesce(p.accepts_preorders, false) then coalesce(p.lead_time_hours, 0) * 60 else 0 end), 0)
      into _prep_minutes, _lead_minutes
    from json_array_elements(_seller_group->'items') it
    join public.products p on p.id = (it->>'product_id')::uuid;

    if _seller_vacation or _seller_status_text = 'paused' then
      _closed_sellers := array_append(_closed_sellers, COALESCE(_seller_name, _seller_id::text));
      continue;
    end if;

    _must_schedule := (_seller_status_text is not null and _seller_status_text not in ('open', 'accepting_preorders'));

    if _must_schedule then
      if _scheduled_date is null or _scheduled_time_start is null then
        return json_build_object(
          'success', false,
          'error', 'schedule_required',
          'message', 'This store is closed. Choose a time after it opens.',
          'seller', COALESCE(_seller_name, _seller_id::text)
        );
      end if;
      if not public.seller_scheduled_slot_is_valid(
        _seller_id,
        nullif(_scheduled_date, '')::date,
        nullif(_scheduled_time_start, '')::time,
        _prep_minutes,
        _lead_minutes
      ) then
        return json_build_object(
          'success', false,
          'error', 'invalid_schedule_slot',
          'message', 'That time is outside this store''s hours. Pick another slot.',
          'seller', COALESCE(_seller_name, _seller_id::text)
        );
      end if;
    elsif _scheduled_date is not null and _scheduled_time_start is not null then
      if not public.seller_scheduled_slot_is_valid(
        _seller_id,
        nullif(_scheduled_date, '')::date,
        nullif(_scheduled_time_start, '')::time,
        _prep_minutes,
        _lead_minutes
      ) then
        return json_build_object(
          'success', false,
          'error', 'invalid_schedule_slot',
          'message', 'That time is outside this store''s hours. Pick another slot.',
          'seller', COALESCE(_seller_name, _seller_id::text)
        );
      end if;
    end if;$new$);

  IF position($acc$_seller_status_text = 'accepting_preorders'$acc$ in src) = 0 THEN
    RAISE EXCEPTION 'scheduled stamp anchor not found on create_multi_vendor_orders';
  END IF;
  src := replace(src,
$old2$    if _seller_status_text = 'accepting_preorders'
       or (_preorder_seller_ids is not null and _seller_id = ANY(_preorder_seller_ids)) then
      _auto_cancel_at := now() + interval '30 minutes';
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _auto_cancel_at := null;
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;$old2$,
$new2$    if _scheduled_date is not null and _scheduled_time_start is not null then
      _auto_cancel_at := now() + interval '30 minutes';
      _effective_scheduled_date := _scheduled_date;
      _effective_scheduled_time := _scheduled_time_start;
    else
      _auto_cancel_at := null;
      _effective_scheduled_date := null;
      _effective_scheduled_time := null;
    end if;$new2$);

  EXECUTE src;
END;
$mig$;

CREATE OR REPLACE FUNCTION public.enqueue_seller_new_order_notification(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_seller_user_id uuid;
  v_seller_business_name text;
  v_buyer_name text;
  v_buyer_flat_no text;
  v_order_items jsonb;
  v_item_line text;
  v_location text;
  v_amount numeric;
  v_title text;
  v_body text;
  v_idem_key text;
  v_when text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_order.status IN ('payment_pending', 'cancelled') THEN
    RETURN;
  END IF;

  SELECT sp.user_id, sp.business_name INTO v_seller_user_id, v_seller_business_name
  FROM public.seller_profiles sp WHERE sp.id = v_order.seller_id;

  IF v_seller_user_id IS NULL THEN
    INSERT INTO public.notification_failures (order_id, seller_user_id, stage, error)
    VALUES (p_order_id, NULL, 'enqueue', 'seller user id missing');
    RETURN;
  END IF;

  SELECT p.name, p.flat_number INTO v_buyer_name, v_buyer_flat_no
  FROM public.profiles p WHERE p.id = v_order.buyer_id;

  SELECT jsonb_agg(jsonb_build_object(
    'product_name', p.name,
    'quantity', oi.quantity,
    'unit_price', oi.unit_price,
    'total_price', oi.quantity * oi.unit_price
  )) INTO v_order_items
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = v_order.id;

  IF v_order_items IS NULL THEN
    v_order_items := '[]'::jsonb;
  END IF;

  v_item_line := public.seller_order_item_summary(v_order.id);
  v_location := public.seller_order_buyer_location_summary(
    v_order.seller_id,
    v_order.buyer_id,
    v_order.delivery_address,
    v_order.delivery_lat,
    v_order.delivery_lng,
    v_order.society_id
  );
  v_amount := v_order.total_amount;
  v_idem_key := md5(v_order.id::text || '-new_order-' || v_order.status::text);

  IF v_order.scheduled_date IS NOT NULL THEN
    v_when := trim(to_char(v_order.scheduled_date, 'DD Mon'))
      || ', '
      || trim(to_char(COALESCE(v_order.scheduled_time_start, time '00:00'), 'FMHH12:MI AM'));
    v_title := left('Scheduled order for ' || v_when, 65);
  ELSIF v_item_line IS NOT NULL THEN
    v_title := left('New order: ' || v_item_line, 65);
  ELSE
    v_title := 'New order received';
  END IF;

  v_body := COALESCE(v_item_line, 'New order');
  IF v_order.scheduled_date IS NOT NULL THEN
    v_body := 'Scheduled for ' || v_when || ' - ' || v_body;
  END IF;
  IF COALESCE(v_amount, 0) > 0 THEN
    v_body := v_body || ' - Rs ' || trim(to_char(v_amount, 'FM9999990'));
  END IF;
  v_body := v_body || ' - ' || COALESCE(v_buyer_name, 'Customer');
  IF v_location IS NOT NULL THEN
    v_body := v_body || ' - ' || v_location;
  END IF;
  v_body := v_body || '. Tap to review and accept.';

  BEGIN
    INSERT INTO public.notification_queue (
      user_id, type, title, body, reference_path, payload, idempotency_key
    )
    VALUES (
      v_seller_user_id,
      'order',
      v_title,
      left(v_body, 240),
      '/orders/' || v_order.id::text,
      jsonb_build_object(
        'orderId', v_order.id::text,
        'order_id', v_order.id::text,
        'status', v_order.status::text,
        'type', 'order',
        'target_role', 'seller',
        'wa_template', 'sociva_new_order_seller',
        'buyer_name', COALESCE(v_buyer_name, 'Customer'),
        'seller_business_name', COALESCE(v_seller_business_name, 'Store'),
        'seller_flat_number', COALESCE(v_buyer_flat_no, ''),
        'buyer_location', v_location,
        'item_summary', v_item_line,
        'items', v_order_items,
        'item_count', COALESCE(jsonb_array_length(v_order_items), 0)
      ),
      v_idem_key
    )
    ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
      SET title = EXCLUDED.title,
          body = EXCLUDED.body,
          payload = EXCLUDED.payload,
          status = CASE
            WHEN notification_queue.status IN ('processed', 'failed', 'blocked') THEN 'pending'
            ELSE notification_queue.status
          END,
          push_skip_reason = NULL,
          next_retry_at = CASE
            WHEN notification_queue.status IN ('processed', 'failed', 'blocked') THEN NULL
            ELSE notification_queue.next_retry_at
          END,
          processed_at = NULL,
          updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.notification_failures (order_id, seller_user_id, stage, error)
      VALUES (p_order_id, v_seller_user_id, 'enqueue', SQLERRM);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'enqueue_seller_new_order_notification could not record failure for order %: %', p_order_id, SQLERRM;
    END;
  END;
END;
$$;
