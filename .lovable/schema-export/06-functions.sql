[map[func_ddl:CREATE OR REPLACE FUNCTION public.accept_worker_job(_job_id uuid, _worker_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.worker_job_requests
  SET status = 'accepted', assigned_worker_id = _worker_id, accepted_at = now(), updated_at = now()
  WHERE id = _job_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job request not found or already accepted';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_maintenance_late_fees()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.maintenance_dues SET late_fee = COALESCE(late_fee, 0) + (amount * 0.02)
  WHERE status = 'overdue' AND due_date < now() - interval '30 days';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_approve_resident()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.society_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.societies
      WHERE id = NEW.society_id AND auto_approve_residents = true
    ) THEN
      NEW.verification_status := 'approved';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_checkout_visitors()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.visitor_entries SET status = 'checked_out', checked_out_at = now()
  WHERE status = 'checked_in' AND created_at < now() - interval '12 hours';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_escalate_overdue_disputes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.dispute_tickets SET status = 'escalated'
  WHERE status IN ('open', 'acknowledged') AND sla_deadline < now();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.book_service_slot(_slot_id uuid, _buyer_id uuid, _seller_id uuid, _product_id uuid, _order_id uuid, _booking_date text, _start_time text, _end_time text, _location_type text DEFAULT 'at_seller'::text, _buyer_address text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _slot record;
  _booking_id uuid;
  _existing_count int;
BEGIN
  -- 1. Check for duplicate booking (same buyer, same slot)
  SELECT COUNT(*) INTO _existing_count
  FROM public.service_bookings
  WHERE buyer_id = _buyer_id
    AND slot_id = _slot_id
    AND status NOT IN ('cancelled', 'no_show');

  IF _existing_count > 0 THEN
    RETURN json_build_object('success', false, 'error', 'You already have a booking for this time slot');
  END IF;

  -- 2. Check for overlapping booking (same buyer, same date, overlapping time)
  SELECT COUNT(*) INTO _existing_count
  FROM public.service_bookings
  WHERE buyer_id = _buyer_id
    AND booking_date = _booking_date::date
    AND status NOT IN ('cancelled', 'no_show')
    AND start_time < _end_time::time
    AND end_time > _start_time::time;

  IF _existing_count > 0 THEN
    RETURN json_build_object('success', false, 'error', 'You have an overlapping booking at this time');
  END IF;

  -- 3. Prevent booking past dates
  IF _booking_date::date < CURRENT_DATE THEN
    RETURN json_build_object('success', false, 'error', 'Cannot book a past date');
  END IF;

  -- 4. Prevent booking same-day if slot time already passed
  IF _booking_date::date = CURRENT_DATE AND _start_time::time < CURRENT_TIME THEN
    RETURN json_build_object('success', false, 'error', 'This time slot has already passed');
  END IF;

  -- 5. Atomically increment booked_count with row lock
  UPDATE public.service_slots
  SET booked_count = booked_count + 1
  WHERE id = _slot_id
    AND is_blocked = false
    AND booked_count < max_capacity
  RETURNING * INTO _slot;

  IF _slot IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Slot is no longer available');
  END IF;

  -- 6. Create service booking
  INSERT INTO public.service_bookings (
    order_id, slot_id, buyer_id, seller_id, product_id,
    booking_date, start_time, end_time, status, location_type, buyer_address
  ) VALUES (
    _order_id, _slot_id, _buyer_id, _seller_id, _product_id,
    _booking_date::date, _start_time::time, _end_time::time, 'requested',
    _location_type, _buyer_address
  )
  RETURNING id INTO _booking_id;

  RETURN json_build_object('success', true, 'booking_id', _booking_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_society_trust_score(_society_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _score numeric := 0; _member_count int;
BEGIN
  SELECT member_count INTO _member_count FROM public.societies WHERE id = _society_id;
  _score := LEAST(_member_count * 2, 30);
  _score := _score + LEAST((SELECT COUNT(*) FROM public.seller_profiles WHERE society_id = _society_id AND verification_status = 'approved') * 5, 30);
  _score := _score + LEAST((SELECT COUNT(*) FROM public.orders WHERE society_id = _society_id AND status = 'completed') / 10, 20);
  IF EXISTS (SELECT 1 FROM public.societies WHERE id = _society_id AND is_verified = true) THEN _score := _score + 20; END IF;
  RETURN LEAST(_score, 100);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_trust_score(_user_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _score numeric := 50;
BEGIN
  -- Verified profile +20
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND verification_status = 'approved') THEN _score := _score + 20; END IF;
  -- Completed orders +1 each (max 20)
  _score := _score + LEAST((SELECT COUNT(*) FROM public.orders WHERE buyer_id = _user_id AND status = 'completed'), 20);
  -- Reviews given +2 each (max 10)
  _score := _score + LEAST((SELECT COUNT(*) * 2 FROM public.reviews WHERE buyer_id = _user_id), 10);
  RETURN LEAST(_score, 100);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_feature(_feature_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _society_id uuid;
BEGIN
  SELECT society_id INTO _society_id FROM public.profiles WHERE id = auth.uid();
  IF _society_id IS NULL THEN RETURN true; END IF;
  RETURN public.is_feature_enabled_for_society(_society_id, _feature_key);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_cancel_booking(_booking_id uuid, _actor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _booking record;
  _listing record;
  _hours_until numeric;
  _is_seller boolean;
  _cancel_fee numeric := 0;
BEGIN
  SELECT sb.*, sl.cancellation_notice_hours, sl.cancellation_fee_percentage
  INTO _booking
  FROM public.service_bookings sb
  LEFT JOIN public.service_listings sl ON sl.product_id = sb.product_id
  WHERE sb.id = _booking_id;

  IF _booking IS NULL THEN
    RETURN json_build_object('can_cancel', false, 'reason', 'Booking not found');
  END IF;

  IF _booking.status IN ('cancelled', 'completed', 'no_show') THEN
    RETURN json_build_object('can_cancel', false, 'reason', 'Booking is already ' || _booking.status);
  END IF;

  -- Check if actor is buyer or seller
  _is_seller := EXISTS (
    SELECT 1 FROM public.seller_profiles WHERE user_id = _actor_id AND id = _booking.seller_id
  );

  -- Sellers can always cancel
  IF _is_seller THEN
    RETURN json_build_object('can_cancel', true, 'fee_percentage', 0, 'reason', 'Seller cancellation');
  END IF;

  -- Buyer must own the booking
  IF _booking.buyer_id != _actor_id THEN
    RETURN json_build_object('can_cancel', false, 'reason', 'Not authorized');
  END IF;

  -- Calculate hours until appointment
  _hours_until := EXTRACT(EPOCH FROM (
    (_booking.booking_date + _booking.start_time) - now()
  )) / 3600;

  IF _hours_until < 0 THEN
    RETURN json_build_object('can_cancel', false, 'reason', 'Appointment has already started');
  END IF;

  -- Check notice period
  IF _booking.cancellation_notice_hours IS NOT NULL AND _hours_until < _booking.cancellation_notice_hours THEN
    _cancel_fee := COALESCE(_booking.cancellation_fee_percentage, 0);
    RETURN json_build_object(
      'can_cancel', true,
      'fee_percentage', _cancel_fee,
      'reason', format('Late cancellation (less than %s hours notice). %s%% fee applies.', _booking.cancellation_notice_hours, _cancel_fee)
    );
  END IF;

  RETURN json_build_object('can_cancel', true, 'fee_percentage', 0, 'reason', 'Within cancellation policy');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_society(_user_id uuid, _society_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_society_admin(_user_id, _society_id)
  OR EXISTS (
    SELECT 1 FROM public.builder_societies bs
    JOIN public.builder_members bm ON bm.builder_id = bs.builder_id
    WHERE bs.society_id = _society_id AND bm.user_id = _user_id
  )
$function$
;

CREATE OR REPLACE FUNCTION public.can_write_to_society(_user_id uuid, _society_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (
    get_user_society_id(_user_id) = _society_id
    OR is_admin(_user_id)
    OR is_society_admin(_user_id, _society_id)
    OR is_builder_for_society(_user_id, _society_id)
  )
$function$
;

CREATE OR REPLACE FUNCTION public.check_first_order_batch(_buyer_id uuid, _seller_ids uuid[])
 RETURNS TABLE(seller_id uuid, is_first_order boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.check_seller_license()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _status text;
BEGIN
  SELECT verification_status INTO _status 
  FROM public.seller_profiles WHERE id = NEW.seller_id;
  
  IF _status IS NULL THEN 
    RAISE EXCEPTION 'Seller profile not found'; 
  END IF;
  
  -- Allow draft/pending sellers to manage products during onboarding
  -- Only block rejected sellers
  IF _status = 'rejected' THEN 
    RAISE EXCEPTION 'Seller not approved (status: %)', _status; 
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_device_token(p_user_id uuid, p_token text, p_platform text, p_apns_token text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Upsert the current token
  INSERT INTO public.device_tokens (user_id, token, platform, apns_token)
  VALUES (p_user_id, p_token, p_platform, p_apns_token)
  ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, apns_token = EXCLUDED.apns_token, updated_at = now();

  -- Remove stale rows for the same user+device (same apns_token but different FCM token)
  -- This prevents duplicate push deliveries when FCM tokens rotate on iOS
  IF p_apns_token IS NOT NULL THEN
    DELETE FROM public.device_tokens
    WHERE user_id = p_user_id
      AND apns_token = p_apns_token
      AND token != p_token;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_notification_queue(batch_size integer DEFAULT 10)
 RETURNS SETOF notification_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.notification_queue SET status = 'processing', processed_at = now()
  WHERE id IN (SELECT id FROM public.notification_queue WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now()) ORDER BY created_at LIMIT batch_size FOR UPDATE SKIP LOCKED)
  RETURNING *;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_worker_job(_job_id uuid, _worker_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.worker_job_requests SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = _job_id AND accepted_by = _worker_id AND status = 'accepted';
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Job not found or not in accepted state'); END IF;
  RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_store_status(p_start time without time zone, p_end time without time zone, p_days text[], p_available boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamp := now();
  v_current_time time := v_now::time;
  v_current_day text := to_char(v_now, 'Dy');
  v_next_open timestamptz;
  v_minutes_until int;
  v_effective_end time;
BEGIN
  IF p_available = false THEN
    RETURN jsonb_build_object('status', 'paused', 'next_open_at', null, 'minutes_until_open', null);
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  END IF;
  IF p_days IS NOT NULL AND array_length(p_days, 1) > 0 AND NOT (v_current_day = ANY(p_days)) THEN
    RETURN jsonb_build_object('status', 'closed_today', 'next_open_at', null, 'minutes_until_open', null);
  END IF;

  -- Treat 00:00:00 as end-of-day (23:59:59) so "09:00-00:00" means open until midnight
  v_effective_end := CASE WHEN p_end = '00:00:00' THEN '23:59:59'::time ELSE p_end END;

  IF v_current_time >= p_start AND v_current_time < v_effective_end THEN
    RETURN jsonb_build_object('status', 'open', 'next_open_at', null, 'minutes_until_open', 0);
  ELSE
    IF v_current_time < p_start THEN
      v_minutes_until := EXTRACT(EPOCH FROM (p_start - v_current_time))::int / 60;
      v_next_open := date_trunc('day', v_now) + p_start;
    ELSE
      v_next_open := date_trunc('day', v_now) + interval '1 day' + p_start;
      v_minutes_until := EXTRACT(EPOCH FROM (v_next_open - v_now))::int / 60;
    END IF;
    RETURN jsonb_build_object('status', 'closed', 'next_open_at', v_next_open, 'minutes_until_open', v_minutes_until);
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.confirm_upi_payment(_order_id uuid, _upi_transaction_ref text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order record;
BEGIN
  -- Validate UTR
  IF _upi_transaction_ref IS NULL OR length(trim(_upi_transaction_ref)) < 6 THEN
    RAISE EXCEPTION 'Invalid transaction reference';
  END IF;

  -- Fetch order and verify ownership
  SELECT id, buyer_id, status, payment_status
  INTO _order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF _order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.status NOT IN ('placed', 'accepted') THEN
    RAISE EXCEPTION 'Order is not in a payable state';
  END IF;

  IF _order.payment_status NOT IN ('pending') THEN
    RAISE EXCEPTION 'Payment already processed';
  END IF;

  -- Update only the allowed fields
  UPDATE public.orders
  SET upi_transaction_ref = trim(_upi_transaction_ref),
      payment_status = 'buyer_confirmed',
      updated_at = now()
  WHERE id = _order_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(_buyer_id uuid, _seller_groups json, _delivery_address text, _notes text, _payment_method text, _payment_status text, _cart_total numeric, _coupon_id text DEFAULT ''::text, _coupon_code text DEFAULT ''::text, _coupon_discount numeric DEFAULT 0, _has_urgent boolean DEFAULT false, _delivery_fee numeric DEFAULT 0, _fulfillment_type text DEFAULT 'delivery'::text)
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
begin
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

  -- Existing order creation flow
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
      fulfillment_type
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
      _fulfillment_type
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(_buyer_id uuid, _seller_groups json, _delivery_address text, _notes text, _payment_method text, _payment_status text, _cart_total numeric, _coupon_id text DEFAULT ''::text, _coupon_code text DEFAULT ''::text, _coupon_discount numeric DEFAULT 0, _has_urgent boolean DEFAULT false, _delivery_fee numeric DEFAULT 0, _fulfillment_type text DEFAULT 'delivery'::text, _delivery_address_id uuid DEFAULT NULL::uuid, _delivery_lat double precision DEFAULT NULL::double precision, _delivery_lng double precision DEFAULT NULL::double precision)
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
begin
  select p.society_id, p.name
    into _society_id, _buyer_name
  from public.profiles p
  where p.id = _buyer_id;

  -- Pre-validate all sellers
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

    -- Delivery radius check
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

  -- Create orders
  for _seller_group in select * from json_array_elements(_seller_groups)
  loop
    _total := 0;
    _order_id := gen_random_uuid();

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      _total := _total + ((_item->>'unit_price')::numeric * (_item->>'quantity')::int);
    end loop;

    insert into public.orders (
      id, buyer_id, seller_id, society_id, status, total_amount,
      payment_type, payment_status, delivery_address, notes, order_type, fulfillment_type,
      delivery_address_id, delivery_lat, delivery_lng
    )
    values (
      _order_id, _buyer_id, (_seller_group->>'seller_id')::uuid, _society_id,
      'placed', _total, _payment_method, _payment_status, _delivery_address, _notes,
      'purchase', _fulfillment_type,
      _delivery_address_id, _delivery_lat, _delivery_lng
    );

    for _item in select * from json_array_elements(_seller_group->'items')
    loop
      insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
      values (_order_id, (_item->>'product_id')::uuid, _item->>'product_name', (_item->>'quantity')::int, (_item->>'unit_price')::numeric);
    end loop;

    select sp.user_id into _seller_user_id
    from public.seller_profiles sp where sp.id = (_seller_group->>'seller_id')::uuid;

    if _seller_user_id is not null then
      insert into public.notification_queue (user_id, type, title, body, reference_path, payload)
      values (_seller_user_id, 'order', '🆕 New Order Received!',
        coalesce(_buyer_name, 'A buyer') || ' placed an order. Tap to view and accept.',
        '/orders/' || _order_id::text,
        jsonb_build_object('orderId', _order_id::text, 'status', 'placed', 'type', 'order'));
    end if;

    _order_ids := _order_ids || _order_id;
  end loop;

  delete from public.cart_items where user_id = _buyer_id;

  return json_build_object('success', true, 'order_ids', to_json(_order_ids));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _gross numeric;
  _fee_pct numeric;
  _platform_fee numeric;
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    _gross := COALESCE(NEW.total_amount, 0);
    
    SELECT COALESCE(NULLIF(value, '')::numeric, 0) INTO _fee_pct
    FROM public.system_settings WHERE key = 'platform_fee_percent';
    
    IF _fee_pct IS NULL THEN _fee_pct := 0; END IF;
    
    _platform_fee := ROUND(_gross * _fee_pct / 100, 2);
    
    INSERT INTO public.payment_settlements (seller_id, order_id, gross_amount, platform_fee, net_amount, settlement_status)
    VALUES (NEW.seller_id, NEW.id, _gross, _platform_fee, _gross - _platform_fee, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.disable_cron_job(p_jobid bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE cron.job SET active = false WHERE jobid = p_jobid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enable_cron_job(p_jobid bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE cron.job SET active = true WHERE jobid = p_jobid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_dispute_status_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _title text;
  _body text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  CASE NEW.status
    WHEN 'under_review' THEN
      _title := '🔍 Dispute Under Review';
      _body := 'Your dispute is now being reviewed by the committee.';
    WHEN 'resolved' THEN
      _title := '✅ Dispute Resolved';
      _body := 'Your dispute has been resolved.' ||
        CASE WHEN NEW.resolution_note IS NOT NULL THEN ' Note: ' || LEFT(NEW.resolution_note, 80) ELSE '' END;
    WHEN 'rejected' THEN
      _title := '❌ Dispute Rejected';
      _body := 'Your dispute has been closed.' ||
        CASE WHEN NEW.resolution_note IS NOT NULL THEN ' Reason: ' || LEFT(NEW.resolution_note, 80) ELSE '' END;
    ELSE
      _title := NULL;
  END CASE;

  IF _title IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      NEW.submitted_by,
      _title,
      _body,
      'dispute',
      '/disputes/' || NEW.id::text,
      jsonb_build_object('disputeId', NEW.id, 'status', NEW.status, 'type', 'dispute')
    );
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_order_status_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _seller_name text;
  _buyer_name text;
  _short_order_id text;
  _notif_title text;
  _notif_body text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _short_order_id := LEFT(NEW.id::text, 8);

  SELECT sp.user_id, sp.business_name
  INTO _seller_user_id, _seller_name
  FROM seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  SELECT p.name INTO _buyer_name
  FROM profiles p
  WHERE p.id = NEW.buyer_id;

  _seller_name := COALESCE(_seller_name, 'Seller');
  _buyer_name := COALESCE(_buyer_name, 'Customer');

  -- Seller notifications
  IF NEW.status = 'placed' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '🆕 New Order Received!',
      _buyer_name || ' placed an order. Tap to view and accept.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  IF NEW.status = 'enquired' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '📋 New Booking Request!',
      _buyer_name || ' sent a booking request.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- NEW: requested status → notify seller
  IF NEW.status = 'requested' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '📩 New Service Request!',
      _buyer_name || ' sent a service request. Tap to review.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- Seller notification for cancellation
  IF NEW.status = 'cancelled' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '❌ Order Cancelled',
      'Order #' || _short_order_id || ' from ' || _buyer_name || ' was cancelled.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- NEW: no_show → notify seller too
  IF NEW.status = 'no_show' AND _seller_user_id IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (_seller_user_id, '🚫 Customer No-Show',
      _buyer_name || ' did not show up for their appointment.',
      'order', '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status));
  END IF;

  -- Buyer notifications
  CASE NEW.status
    WHEN 'accepted' THEN
      _notif_title := '✅ Order Accepted!';
      _notif_body := _seller_name || ' accepted your order and will start preparing it.';
    WHEN 'preparing' THEN
      _notif_title := '👨‍🍳 Order Being Prepared';
      _notif_body := _seller_name || ' is now preparing your order.';
    WHEN 'ready' THEN
      _notif_title := '🎉 Order Ready!';
      _notif_body := 'Your order from ' || _seller_name || ' is ready for pickup!';
    WHEN 'assigned' THEN
      _notif_title := '👤 Partner Assigned';
      _notif_body := 'A delivery partner has been assigned to your order.';
    WHEN 'picked_up' THEN
      _notif_title := '📦 Order Picked Up';
      _notif_body := 'Your order from ' || _seller_name || ' has been picked up.';
    WHEN 'on_the_way' THEN
      _notif_title := '🛵 Order On The Way!';
      _notif_body := 'Your order from ' || _seller_name || ' is on the way to you!';
    WHEN 'arrived' THEN
      _notif_title := '🏠 Service Provider Arrived';
      _notif_body := 'Your service provider from ' || _seller_name || ' has arrived.';
    WHEN 'in_progress' THEN
      _notif_title := '🔧 Service In Progress';
      _notif_body := _seller_name || ' has started working on your request.';
    WHEN 'delivered' THEN
      _notif_title := '🚚 Order Delivered';
      _notif_body := 'Your order from ' || _seller_name || ' has been delivered!';
    WHEN 'completed' THEN
      _notif_title := '⭐ Order Completed';
      _notif_body := 'Your order from ' || _seller_name || ' is complete. Leave a review!';
    WHEN 'cancelled' THEN
      _notif_title := '❌ Order Cancelled';
      _notif_body := 'Your order from ' || _seller_name || ' was cancelled.';
    WHEN 'quoted' THEN
      _notif_title := '💰 Quote Received';
      _notif_body := _seller_name || ' sent you a price quote for your enquiry.';
    WHEN 'scheduled' THEN
      _notif_title := '📅 Booking Confirmed';
      _notif_body := _seller_name || ' confirmed your booking.';
    WHEN 'confirmed' THEN
      _notif_title := '✅ Booking Confirmed';
      _notif_body := _seller_name || ' has confirmed your appointment.';
    WHEN 'no_show' THEN
      _notif_title := '🚫 Marked as No-Show';
      _notif_body := 'You were marked as a no-show for your appointment with ' || _seller_name || '.';
    WHEN 'returned' THEN
      _notif_title := '↩️ Order Returned';
      _notif_body := 'Your order from ' || _seller_name || ' has been returned.';
    ELSE
      _notif_title := NULL;
  END CASE;

  IF _notif_title IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      NEW.buyer_id,
      _notif_title,
      _notif_body,
      'order',
      '/orders/' || NEW.id::text,
      jsonb_build_object('orderId', NEW.id, 'status', NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_product_review_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_name text;
  _admin_row record;
BEGIN
  -- Only fire when approval_status changes TO 'pending'
  IF NEW.approval_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.approval_status IS NOT DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  -- Get seller business name
  SELECT sp.business_name INTO _seller_name
  FROM public.seller_profiles sp
  WHERE sp.id = NEW.seller_id;

  _seller_name := COALESCE(_seller_name, 'Unknown Store');

  -- Notify all admin-role users
  FOR _admin_row IN
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin'
  LOOP
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      _admin_row.user_id,
      '📦 New Product for Review',
      '"' || COALESCE(NEW.name, 'A product') || '" from "' || _seller_name || '" needs review.',
      'moderation',
      '/admin',
      jsonb_build_object('type', 'product_review', 'productId', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_review_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
  _buyer_name text;
BEGIN
  SELECT sp.user_id INTO _seller_user_id
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  IF _seller_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT p.name INTO _buyer_name
  FROM profiles p WHERE p.id = NEW.buyer_id;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    _seller_user_id,
    '⭐ New Review!',
    COALESCE(_buyer_name, 'A customer') || ' rated you ' || NEW.rating || '/5' ||
      CASE WHEN NEW.comment IS NOT NULL AND LENGTH(NEW.comment) > 0
        THEN ': "' || LEFT(NEW.comment, 60) || CASE WHEN LENGTH(NEW.comment) > 60 THEN '..."' ELSE '"' END
        ELSE '.' END,
    'review',
    '/seller/reviews',
    jsonb_build_object('reviewId', NEW.id, 'rating', NEW.rating, 'type', 'review')
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_settlement_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _seller_user_id uuid;
BEGIN
  SELECT sp.user_id INTO _seller_user_id
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  IF _seller_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    _seller_user_id,
    '💰 Payment Settlement Created',
    'A settlement of ₹' || NEW.net_amount || ' has been initiated for your order.',
    'settlement',
    '/seller/settlements',
    jsonb_build_object('settlementId', NEW.id, 'amount', NEW.net_amount, 'type', 'settlement')
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_user_id uuid;
  v_buyer_name text;
BEGIN
  -- Get seller user_id
  SELECT sp.user_id INTO v_seller_user_id
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  IF v_seller_user_id IS NULL THEN RETURN NEW; END IF;

  -- Get buyer name
  SELECT p.name INTO v_buyer_name
  FROM public.profiles p WHERE p.id = NEW.buyer_id;

  INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
  VALUES (
    v_seller_user_id,
    'order',
    '🆕 New Order Received!',
    COALESCE(v_buyer_name, 'A buyer') || ' placed an order. Tap to view and accept.',
    '/orders/' || NEW.id::text,
    jsonb_build_object('orderId', NEW.id::text, 'status', NEW.status::text, 'type', 'order')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_new_order_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_enqueue_order_status_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_seller_name text;
  v_title text;
  v_body text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT sp.business_name INTO v_seller_name
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  CASE NEW.status
    WHEN 'accepted' THEN
      v_title := '✅ Order Accepted!';
      v_body := COALESCE(v_seller_name, 'The seller') || ' has accepted your order.';
    WHEN 'preparing' THEN
      v_title := '👨‍🍳 Being Prepared';
      v_body := 'Your order is being prepared by ' || COALESCE(v_seller_name, 'the seller') || '.';
    WHEN 'ready' THEN
      v_title := '🎉 Order Ready!';
      v_body := 'Your order from ' || COALESCE(v_seller_name, 'the seller') || ' is ready for pickup!';
    WHEN 'picked_up' THEN
      v_title := '📦 Order Picked Up';
      v_body := 'Your order has been picked up for delivery.';
    WHEN 'delivered' THEN
      v_title := '🚚 Order Delivered!';
      v_body := 'Your order from ' || COALESCE(v_seller_name, 'the seller') || ' has been delivered.';
    WHEN 'completed' THEN
      v_title := '⭐ Order Completed';
      v_body := 'Your order is complete. Leave a review for ' || COALESCE(v_seller_name, 'the seller') || '!';
    WHEN 'cancelled' THEN
      v_title := '❌ Order Cancelled';
      v_body := 'Your order from ' || COALESCE(v_seller_name, 'the seller') || ' has been cancelled.';
    WHEN 'quoted' THEN
      v_title := '💰 Quote Received';
      v_body := COALESCE(v_seller_name, 'The seller') || ' sent you a price quote.';
    WHEN 'scheduled' THEN
      v_title := '📅 Booking Confirmed';
      v_body := 'Your booking with ' || COALESCE(v_seller_name, 'the seller') || ' has been confirmed.';
    WHEN 'confirmed' THEN
      v_title := '✅ Appointment Confirmed';
      v_body := 'Your appointment with ' || COALESCE(v_seller_name, 'the seller') || ' is confirmed.';
    WHEN 'on_the_way' THEN
      v_title := '🚗 On The Way';
      v_body := COALESCE(v_seller_name, 'The service provider') || ' is on the way to you.';
    WHEN 'arrived' THEN
      v_title := '📍 Arrived';
      v_body := COALESCE(v_seller_name, 'The service provider') || ' has arrived.';
    WHEN 'in_progress' THEN
      v_title := '🔧 Service In Progress';
      v_body := 'Your service with ' || COALESCE(v_seller_name, 'the seller') || ' is in progress.';
    WHEN 'rescheduled' THEN
      v_title := '🔄 Appointment Rescheduled';
      v_body := 'Your appointment with ' || COALESCE(v_seller_name, 'the seller') || ' has been rescheduled.';
    WHEN 'no_show' THEN
      v_title := '⚠️ No Show';
      v_body := 'You were marked as a no-show for your appointment with ' || COALESCE(v_seller_name, 'the seller') || '.';
    WHEN 'requested' THEN
      v_title := '📋 Booking Requested';
      v_body := 'Your service booking with ' || COALESCE(v_seller_name, 'the seller') || ' has been submitted.';
    ELSE
      RETURN NEW;
  END CASE;

  INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
  VALUES (
    NEW.buyer_id, 'order', v_title, v_body,
    '/orders/' || NEW.id::text,
    jsonb_build_object('orderId', NEW.id::text, 'status', NEW.status::text, 'type', 'order_status')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_enqueue_order_status_notification failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_recurring_visitor_entries()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Generate today's entries from recurring visitors
  INSERT INTO public.visitor_entries (visitor_name, visitor_phone, visitor_type, resident_id, society_id, status, is_preapproved, is_recurring, purpose)
  SELECT ve.visitor_name, ve.visitor_phone, ve.visitor_type, ve.resident_id, ve.society_id, 'expected', true, true, ve.purpose
  FROM public.visitor_entries ve
  WHERE ve.is_recurring = true AND ve.status != 'cancelled'
    AND to_char(now(), 'Dy') = ANY(ve.recurring_days)
    AND NOT EXISTS (SELECT 1 FROM public.visitor_entries ve2 WHERE ve2.visitor_phone = ve.visitor_phone AND ve2.society_id = ve.society_id AND ve2.created_at::date = CURRENT_DATE);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_allowed_transitions(_order_id uuid, _actor text DEFAULT 'seller'::text)
 RETURNS TABLE(status_key text, sort_order integer, actor text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _current_status text; _parent_group text; _transaction_type text;
BEGIN
  SELECT o.status::text, COALESCE(cc.parent_group, 'food'), COALESCE(cc.transaction_type, 'purchase')
  INTO _current_status, _parent_group, _transaction_type
  FROM public.orders o
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.category_config cc ON cc.category::text = p.category::text
  WHERE o.id = _order_id LIMIT 1;

  RETURN QUERY
  SELECT csf.status_key, csf.sort_order, csf.actor
  FROM public.category_status_flows csf
  WHERE csf.parent_group = _parent_group
    AND csf.transaction_type = _transaction_type
    AND csf.actor = _actor
    AND csf.sort_order > (SELECT COALESCE(csf2.sort_order, 0) FROM public.category_status_flows csf2 WHERE csf2.parent_group = _parent_group AND csf2.transaction_type = _transaction_type AND csf2.status_key = _current_status LIMIT 1)
  ORDER BY csf.sort_order;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_builder_dashboard(_builder_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _result json;
BEGIN
  SELECT json_build_object(
    'society_count', (SELECT COUNT(*) FROM public.builder_societies WHERE builder_id = _builder_id),
    'total_members', (SELECT COALESCE(SUM(s.member_count), 0) FROM public.builder_societies bs JOIN public.societies s ON s.id = bs.society_id WHERE bs.builder_id = _builder_id),
    'active_snags', (SELECT COUNT(*) FROM public.snag_tickets st JOIN public.builder_societies bs ON bs.society_id = st.society_id WHERE bs.builder_id = _builder_id AND st.status NOT IN ('resolved', 'closed')),
    'pending_milestones', (SELECT COUNT(*) FROM public.construction_milestones cm JOIN public.builder_societies bs ON bs.society_id = cm.society_id WHERE bs.builder_id = _builder_id AND cm.completion_percentage < 100)
  ) INTO _result;
  RETURN _result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_category_parent_group(cat text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT parent_group FROM public.category_config WHERE category::text = cat LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_cron_job_runs(p_jobid bigint, p_limit integer DEFAULT 20)
 RETURNS TABLE(runid bigint, job_id bigint, status text, return_message text, start_time timestamp with time zone, end_time timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT runid, jobid, status::text, return_message::text, start_time, end_time
  FROM cron.job_run_details
  WHERE (p_jobid = 0 OR jobid = p_jobid)
  ORDER BY start_time DESC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_cron_jobs()
 RETURNS TABLE(jobid bigint, jobname text, schedule text, command text, active boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jobid, jobname::text, schedule::text, command::text, active
  FROM cron.job
  ORDER BY jobid;
$function$
;

CREATE OR REPLACE FUNCTION public.get_delivery_scores_batch(_seller_ids uuid[])
 RETURNS TABLE(seller_id uuid, total_deliveries bigint, on_time_pct numeric, avg_delay_minutes numeric, completion_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT o.seller_id,
    COUNT(da.id),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered' AND (da.eta_minutes IS NULL OR EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60 <= da.eta_minutes * 1.2)) * 100.0 / NULLIF(COUNT(*), 0), 1)
    END,
    COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60) FILTER (WHERE da.delivered_at IS NOT NULL), 1), 0),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered') * 100.0 / NULLIF(COUNT(*), 0), 1)
    END
  FROM public.delivery_assignments da
  JOIN public.orders o ON o.id = da.order_id
  WHERE o.seller_id = ANY(_seller_ids)
  GROUP BY o.seller_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id uuid)
 RETURNS TABLE(feature_key text, is_enabled boolean, source text, society_configurable boolean, display_name text, description text, icon_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5s'
AS $function$
BEGIN
  RETURN QUERY
  WITH builder_for_society AS (
    SELECT bs.builder_id FROM builder_societies bs WHERE bs.society_id = _society_id LIMIT 1
  ),
  package_features AS (
    SELECT pf.feature_key, fpi.enabled AS is_enabled, pf.id AS feature_id, pf.is_core, pf.society_configurable, pf.display_name, pf.description, pf.icon_name
    FROM builder_for_society bfs
    JOIN builder_feature_packages bfp ON bfp.builder_id = bfs.builder_id AND (bfp.expires_at IS NULL OR bfp.expires_at > now())
    JOIN feature_package_items fpi ON fpi.package_id = bfp.package_id
    JOIN platform_features pf ON pf.id = fpi.feature_id
  ),
  overrides AS (
    SELECT sfo.feature_id, sfo.is_enabled FROM society_feature_overrides sfo WHERE sfo.society_id = _society_id
  )
  SELECT pf_agg.feature_key,
    CASE WHEN pf_agg.is_core THEN true WHEN o.feature_id IS NOT NULL THEN o.is_enabled ELSE pf_agg.is_enabled END,
    CASE WHEN pf_agg.is_core THEN 'core' WHEN o.feature_id IS NOT NULL THEN 'override' ELSE 'package' END,
    pf_agg.society_configurable, pf_agg.display_name, pf_agg.description, pf_agg.icon_name
  FROM (SELECT pff.feature_key, pff.feature_id, pff.is_core, pff.society_configurable, pff.display_name, pff.description, pff.icon_name, bool_or(pff.is_enabled) AS is_enabled FROM package_features pff GROUP BY pff.feature_key, pff.feature_id, pff.is_core, pff.society_configurable, pff.display_name, pff.description, pff.icon_name) pf_agg
  LEFT JOIN overrides o ON o.feature_id = pf_agg.feature_id
  UNION ALL
  SELECT pf2.feature_key, true, 'core', pf2.society_configurable, pf2.display_name, pf2.description, pf2.icon_name FROM platform_features pf2
  WHERE pf2.is_core = true AND NOT EXISTS (SELECT 1 FROM builder_for_society bfs2 JOIN builder_feature_packages bfp2 ON bfp2.builder_id = bfs2.builder_id JOIN feature_package_items fpi2 ON fpi2.package_id = bfp2.package_id AND fpi2.feature_id = pf2.id)
  UNION ALL
  SELECT pf3.feature_key,
    CASE WHEN pf3.is_core THEN true WHEN o3.feature_id IS NOT NULL THEN o3.is_enabled ELSE false END,
    CASE WHEN o3.feature_id IS NOT NULL THEN 'override' ELSE 'default' END,
    pf3.society_configurable, pf3.display_name, pf3.description, pf3.icon_name
  FROM platform_features pf3
  LEFT JOIN society_feature_overrides o3 ON o3.feature_id = pf3.id AND o3.society_id = _society_id
  WHERE NOT EXISTS (SELECT 1 FROM builder_for_society);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_location_stats(_lat double precision, _lng double precision, _radius_km double precision DEFAULT 5)
 RETURNS TABLE(sellers_count bigint, orders_today bigint, societies_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _box_delta double precision;
BEGIN
  _box_delta := _radius_km * 0.009;

  RETURN QUERY
  WITH nearby_sellers AS (
    SELECT sp.id AS seller_id, sp.society_id
    FROM public.seller_profiles sp
    LEFT JOIN public.societies s
      ON s.id = sp.society_id
      AND s.latitude IS NOT NULL
      AND s.longitude IS NOT NULL
    WHERE sp.verification_status = 'approved'
      AND sp.is_available = true
      AND COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
      AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
      AND COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
      AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
      AND public.haversine_km(_lat, _lng,
          COALESCE(sp.latitude, s.latitude::double precision),
          COALESCE(sp.longitude, s.longitude::double precision)
        ) <= _radius_km
  )
  SELECT
    (SELECT COUNT(*) FROM nearby_sellers)::bigint,
    (SELECT COUNT(*)
     FROM public.orders o
     WHERE o.seller_id IN (SELECT ns.seller_id FROM nearby_sellers ns)
       AND o.created_at > now() - interval '24 hours'
       AND o.status NOT IN ('cancelled')
    )::bigint,
    (SELECT COUNT(DISTINCT ns.society_id) FROM nearby_sellers ns WHERE ns.society_id IS NOT NULL)::bigint;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_nearby_societies(_society_id uuid, _radius_km double precision DEFAULT 10)
 RETURNS TABLE(id uuid, name text, distance_km double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _lat double precision; _lng double precision;
BEGIN
  SELECT latitude, longitude INTO _lat, _lng FROM public.societies WHERE societies.id = _society_id;
  IF _lat IS NULL OR _lng IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT s.id, s.name, public.haversine_km(_lat, _lng, s.latitude, s.longitude) AS distance_km
  FROM public.societies s
  WHERE s.id != _society_id AND s.is_active = true AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND public.haversine_km(_lat, _lng, s.latitude, s.longitude) <= _radius_km
  ORDER BY distance_km;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_price_stability(_product_id uuid)
 RETURNS TABLE(days_stable integer, price_change numeric, direction text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _last_change record;
BEGIN
  SELECT * INTO _last_change
  FROM public.price_history
  WHERE product_id = _product_id
  ORDER BY changed_at DESC LIMIT 1;

  IF _last_change IS NULL THEN
    RETURN QUERY SELECT
      EXTRACT(DAY FROM now() - (SELECT created_at FROM public.products WHERE id = _product_id))::integer,
      0::numeric,
      'stable'::text;
  ELSE
    RETURN QUERY SELECT
      EXTRACT(DAY FROM now() - _last_change.changed_at)::integer,
      ABS(_last_change.new_price - _last_change.old_price),
      CASE WHEN _last_change.new_price > _last_change.old_price THEN 'up'
           WHEN _last_change.new_price < _last_change.old_price THEN 'down'
           ELSE 'stable' END;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_product_trust_metrics(_product_ids uuid[])
 RETURNS TABLE(product_id uuid, total_orders bigint, unique_buyers bigint, repeat_buyer_count bigint, last_ordered_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT oi.product_id, COUNT(DISTINCT o.id), COUNT(DISTINCT o.buyer_id),
    COUNT(DISTINCT o.buyer_id) FILTER (WHERE (SELECT COUNT(*) FROM public.orders o2 JOIN public.order_items oi2 ON oi2.order_id = o2.id WHERE oi2.product_id = oi.product_id AND o2.buyer_id = o.buyer_id AND o2.status = 'completed') > 1),
    MAX(o.created_at)
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.product_id = ANY(_product_ids) AND o.status = 'completed'
  GROUP BY oi.product_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_refund_tier(_amount numeric)
 RETURNS json
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _amount < 200 THEN
    RETURN json_build_object('tier', 'instant', 'label', 'Instant Refund', 'description', 'Processed immediately');
  ELSIF _amount <= 1000 THEN
    RETURN json_build_object('tier', '24h', 'label', '24h Review', 'description', 'Reviewed within 24 hours');
  ELSE
    RETURN json_build_object('tier', 'mediation', 'label', 'Dispute Mediation', 'description', 'Handled by community committee');
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_delivery_score(_seller_id uuid)
 RETURNS TABLE(total_deliveries bigint, on_time_pct numeric, avg_delay_minutes numeric, completion_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(da.id),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered' AND (da.eta_minutes IS NULL OR EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60 <= da.eta_minutes * 1.2)) * 100.0 / NULLIF(COUNT(*), 0), 1)
    END,
    COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60) FILTER (WHERE da.delivered_at IS NOT NULL), 1), 0),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered') * 100.0 / NULLIF(COUNT(*), 0), 1)
    END
  FROM public.delivery_assignments da
  JOIN public.orders o ON o.id = da.order_id
  WHERE o.seller_id = _seller_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_demand_stats(_seller_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _society_id uuid;
  _active_buyers int;
  _view_count int;
  _order_count int;
  _conversion_rate numeric;
BEGIN
  SELECT society_id INTO _society_id FROM seller_profiles WHERE id = _seller_id;

  -- Active buyers: society-scoped for society sellers, seller-scoped for commercial
  IF _society_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT o.buyer_id) INTO _active_buyers
    FROM orders o
    JOIN profiles p ON p.id = o.buyer_id
    WHERE p.society_id = _society_id
      AND o.created_at > now() - interval '30 days'
      AND o.status != 'cancelled';
  ELSE
    SELECT COUNT(DISTINCT o.buyer_id) INTO _active_buyers
    FROM orders o
    WHERE o.seller_id = _seller_id
      AND o.created_at > now() - interval '30 days'
      AND o.status != 'cancelled';
  END IF;

  -- View count from search_demand_log
  SELECT COALESCE(SUM(sdl.search_count), 0) INTO _view_count
  FROM search_demand_log sdl
  WHERE (_society_id IS NOT NULL AND sdl.society_id = _society_id)
     OR (_society_id IS NULL AND EXISTS (
       SELECT 1 FROM products p WHERE p.seller_id = _seller_id AND p.category::text = sdl.search_term
     ));

  -- Order count for this seller
  SELECT COUNT(*) INTO _order_count
  FROM orders o
  WHERE o.seller_id = _seller_id
    AND o.created_at > now() - interval '30 days'
    AND o.status != 'cancelled';

  -- Conversion rate
  IF _view_count > 0 THEN
    _conversion_rate := ROUND((_order_count::numeric / _view_count) * 100, 1);
  ELSE
    _conversion_rate := 0;
  END IF;

  RETURN json_build_object(
    'active_buyers_in_society', _active_buyers,
    'view_count', _view_count,
    'order_count', _order_count,
    'conversion_rate', _conversion_rate
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_recommendations(_seller_id uuid)
 RETURNS TABLE(total_count bigint, recommenders json)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*),
    COALESCE(
      (SELECT json_agg(json_build_object('name', p.name, 'flat_number', p.flat_number, 'block', p.block))
       FROM (SELECT sr.recommender_id FROM public.seller_recommendations sr WHERE sr.seller_id = _seller_id ORDER BY sr.created_at DESC LIMIT 5) recent
       JOIN public.profiles p ON p.id = recent.recommender_id),
      '[]'::json
    )
  FROM public.seller_recommendations sr
  WHERE sr.seller_id = _seller_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_trust_snapshot(_seller_id uuid)
 RETURNS TABLE(completed_orders bigint, cancelled_orders bigint, unique_customers bigint, repeat_customer_pct numeric, avg_response_min numeric, recent_order_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed'),
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'cancelled'),
    (SELECT COUNT(DISTINCT buyer_id) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed'),
    CASE WHEN (SELECT COUNT(DISTINCT buyer_id) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed') = 0 THEN 0
      ELSE (SELECT COUNT(DISTINCT buyer_id) FILTER (WHERE cnt > 1) * 100.0 / COUNT(DISTINCT buyer_id) FROM (SELECT buyer_id, COUNT(*) as cnt FROM public.orders WHERE seller_id = _seller_id AND status = 'completed' GROUP BY buyer_id) sub) END,
    COALESCE((SELECT sp.avg_response_minutes FROM public.seller_profiles sp WHERE sp.id = _seller_id), 0),
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed' AND created_at > now() - interval '30 days');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_seller_trust_tier(_seller_id uuid)
 RETURNS TABLE(tier_key text, tier_label text, badge_color text, icon_name text, growth_label text, growth_icon text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _orders integer;
  _rating numeric;
BEGIN
  SELECT COALESCE(sp.completed_order_count, 0), COALESCE(sp.rating, 0)
  INTO _orders, _rating
  FROM public.seller_profiles sp WHERE sp.id = _seller_id;

  RETURN QUERY
  SELECT t.tier_key, t.tier_label, t.badge_color, t.icon_name, t.growth_label, t.growth_icon
  FROM public.trust_tier_config t
  WHERE t.is_active = true
    AND _orders >= t.min_orders
    AND _rating >= t.min_rating
  ORDER BY t.display_order DESC
  LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_society_order_stats(_society_id uuid, _product_ids uuid[])
 RETURNS TABLE(product_id uuid, families_this_week bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT oi.product_id, COUNT(DISTINCT o.buyer_id)
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.product_id = ANY(_product_ids) AND o.society_id = _society_id AND o.created_at > now() - interval '7 days' AND o.status NOT IN ('cancelled')
  GROUP BY oi.product_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_society_order_stats(_product_ids uuid[], _society_id uuid DEFAULT NULL::uuid, _lat double precision DEFAULT NULL::double precision, _lng double precision DEFAULT NULL::double precision, _radius_km double precision DEFAULT 5)
 RETURNS TABLE(product_id uuid, families_this_week bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _box_delta double precision;
BEGIN
  -- Coordinate-based: count distinct buyers within radius
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    _box_delta := _radius_km * 0.009;

    RETURN QUERY
    SELECT oi.product_id, COUNT(DISTINCT o.buyer_id)::bigint AS families_this_week
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.delivery_addresses da ON da.user_id = o.buyer_id AND da.is_default = true
    WHERE oi.product_id = ANY(_product_ids)
      AND o.status NOT IN ('cancelled')
      AND o.created_at > now() - interval '7 days'
      AND da.latitude IS NOT NULL AND da.longitude IS NOT NULL
      AND da.latitude BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
      AND da.longitude BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
      AND public.haversine_km(_lat, _lng, da.latitude, da.longitude) <= _radius_km
    GROUP BY oi.product_id;

  -- Legacy: society-scoped counting
  ELSIF _society_id IS NOT NULL THEN
    RETURN QUERY
    SELECT oi.product_id, COUNT(DISTINCT o.buyer_id)::bigint AS families_this_week
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.profiles p ON p.id = o.buyer_id
    WHERE oi.product_id = ANY(_product_ids)
      AND p.society_id = _society_id
      AND o.status NOT IN ('cancelled')
      AND o.created_at > now() - interval '7 days'
    GROUP BY oi.product_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_society_search_suggestions(_society_id uuid, _limit integer DEFAULT 8)
 RETURNS TABLE(term text, count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT LOWER(TRIM(sdl.search_term)) AS term, COUNT(*) AS count
  FROM public.search_demand_log sdl
  WHERE sdl.society_id = _society_id
    AND sdl.created_at > now() - interval '14 days'
    AND LENGTH(TRIM(sdl.search_term)) >= 2
  GROUP BY LOWER(TRIM(sdl.search_term))
  HAVING COUNT(*) >= 2
  ORDER BY count DESC
  LIMIT _limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_society_top_products(_society_id uuid, _limit integer DEFAULT 5)
 RETURNS TABLE(product_id uuid, product_name text, image_url text, order_count bigint, seller_name text, seller_id uuid, price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT oi.product_id, p.name, p.image_url, COUNT(*)::bigint AS order_count,
    sp.business_name, p.seller_id, p.price
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.society_id = _society_id AND o.status NOT IN ('cancelled')
  GROUP BY oi.product_id, p.name, p.image_url, sp.business_name, p.seller_id, p.price
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_trending_products_by_society(_society_id uuid, _limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, name text, description text, price numeric, image_url text, category text, is_veg boolean, is_available boolean, is_bestseller boolean, is_recommended boolean, is_urgent boolean, seller_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, approval_status text, seller_business_name text, seller_rating numeric, seller_society_id uuid, seller_verification_status text, seller_fulfillment_mode text, seller_delivery_note text, seller_availability_start time without time zone, seller_availability_end time without time zone, seller_operating_days text[], seller_is_available boolean, seller_completed_order_count integer, seller_last_active_at timestamp with time zone, order_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.description, p.price, p.image_url,
    p.category::text, p.is_veg, p.is_available, p.is_bestseller,
    p.is_recommended, p.is_urgent, p.seller_id, p.created_at, p.updated_at,
    p.approval_status::text,
    sp.business_name, sp.rating, sp.society_id,
    sp.verification_status::text, sp.fulfillment_mode::text,
    sp.delivery_note, sp.availability_start, sp.availability_end,
    sp.operating_days, sp.is_available,
    sp.completed_order_count, sp.last_active_at,
    COUNT(oi.id)::bigint AS order_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.society_id = _society_id
    AND o.status NOT IN ('cancelled')
    AND o.created_at > now() - interval '7 days'
    AND p.is_available = true
    AND p.approval_status = 'approved'
    AND sp.verification_status = 'approved'
  GROUP BY p.id, p.name, p.description, p.price, p.image_url,
    p.category, p.is_veg, p.is_available, p.is_bestseller,
    p.is_recommended, p.is_urgent, p.seller_id, p.created_at, p.updated_at,
    p.approval_status,
    sp.business_name, sp.rating, sp.society_id,
    sp.verification_status, sp.fulfillment_mode,
    sp.delivery_note, sp.availability_start, sp.availability_end,
    sp.operating_days, sp.is_available,
    sp.completed_order_count, sp.last_active_at
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unified_gate_log(_society_id uuid, _date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(entry_type text, person_name text, flat_number text, entry_time timestamp with time zone, exit_time timestamp with time zone, status text, details text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 'visitor'::text, ve.visitor_name, p.flat_number, ve.created_at, ve.checked_out_at, ve.status,
    COALESCE(ve.purpose, ve.visitor_type)
  FROM public.visitor_entries ve
  JOIN public.profiles p ON p.id = ve.resident_id
  WHERE ve.society_id = _society_id AND ve.created_at::date = _date
  UNION ALL
  SELECT 'worker'::text, sw.name, COALESCE(wfa.flat_number, ''), wel.entry_time, wel.exit_time, wel.validation_result, sw.worker_type
  FROM public.worker_entry_logs wel
  JOIN public.society_workers sw ON sw.id = wel.worker_id
  LEFT JOIN public.worker_flat_assignments wfa ON wfa.worker_id = sw.id AND wfa.is_active = true
  WHERE wel.society_id = _society_id AND wel.entry_time::date = _date
  ORDER BY entry_time DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unmet_demand(_society_id uuid, _seller_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(search_term text, search_count bigint, last_searched timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sdl.search_term, COUNT(*)::bigint, MAX(sdl.searched_at)
  FROM public.search_demand_log sdl
  WHERE
    CASE
      -- If society provided, scope to that society
      WHEN _society_id IS NOT NULL THEN sdl.society_id = _society_id
      -- If seller_id provided (commercial seller), scope to societies where they have orders
      WHEN _seller_id IS NOT NULL THEN (
        sdl.society_id IS NULL
        OR sdl.society_id IN (
          SELECT DISTINCT o.society_id FROM public.orders o
          WHERE o.seller_id = _seller_id AND o.society_id IS NOT NULL
        )
      )
      -- Fallback: only null-society logs
      ELSE sdl.society_id IS NULL
    END
  GROUP BY sdl.search_term
  ORDER BY COUNT(*) DESC LIMIT 20;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unmet_demand(_society_id uuid, _seller_categories text[] DEFAULT NULL::text[])
 RETURNS TABLE(search_term text, search_count bigint, last_searched timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sdl.search_term, COUNT(*)::bigint, MAX(sdl.searched_at)
  FROM public.search_demand_log sdl
  WHERE sdl.society_id = _society_id
  GROUP BY sdl.search_term
  ORDER BY COUNT(*) DESC LIMIT 20;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_unmet_demand(_society_id uuid)
 RETURNS TABLE(search_term text, search_count bigint, last_searched timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sdl.search_term, COUNT(*)::bigint, MAX(sdl.searched_at)
  FROM public.search_demand_log sdl
  WHERE (_society_id IS NOT NULL AND sdl.society_id = _society_id)
     OR (_society_id IS NULL)
  GROUP BY sdl.search_term
  ORDER BY COUNT(*) DESC LIMIT 20;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_auth_context(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _profile jsonb;
  _society jsonb;
  _roles jsonb;
  _seller_profiles jsonb;
  _society_admin_role jsonb;
  _builder_ids jsonb;
  _is_security_officer boolean;
  _is_worker boolean;
  _society_id uuid;
BEGIN
  -- Profile
  SELECT to_jsonb(p.*) INTO _profile
  FROM public.profiles p
  WHERE p.id = _user_id;

  IF _profile IS NULL THEN
    RETURN jsonb_build_object(
      'profile', null,
      'society', null,
      'roles', '[]'::jsonb,
      'seller_profiles', '[]'::jsonb,
      'society_admin_role', null,
      'builder_ids', '[]'::jsonb,
      'is_security_officer', false,
      'is_worker', false
    );
  END IF;

  _society_id := (_profile->>'society_id')::uuid;

  -- Society
  IF _society_id IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO _society
    FROM public.societies s
    WHERE s.id = _society_id;
  END IF;

  -- Roles
  SELECT coalesce(jsonb_agg(to_jsonb(r.*)), '[]'::jsonb) INTO _roles
  FROM public.user_roles r
  WHERE r.user_id = _user_id;

  -- Seller profiles
  SELECT coalesce(jsonb_agg(to_jsonb(sp.*)), '[]'::jsonb) INTO _seller_profiles
  FROM public.seller_profiles sp
  WHERE sp.user_id = _user_id;

  -- Society admin role
  SELECT to_jsonb(sa.*) INTO _society_admin_role
  FROM public.society_admins sa
  WHERE sa.user_id = _user_id
    AND sa.deactivated_at IS NULL
  LIMIT 1;

  -- Builder IDs
  SELECT coalesce(jsonb_agg(bm.builder_id), '[]'::jsonb) INTO _builder_ids
  FROM public.builder_members bm
  WHERE bm.user_id = _user_id
    AND bm.deactivated_at IS NULL;

  -- Security officer check
  IF _society_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.security_staff
      WHERE user_id = _user_id AND society_id = _society_id AND is_active = true AND deactivated_at IS NULL
    ) INTO _is_security_officer;
  ELSE
    _is_security_officer := false;
  END IF;

  -- Worker check
  _is_worker := public.has_role(_user_id, 'security_officer');

  RETURN jsonb_build_object(
    'profile', _profile,
    'society', _society,
    'roles', _roles,
    'seller_profiles', _seller_profiles,
    'society_admin_role', _society_admin_role,
    'builder_ids', _builder_ids,
    'is_security_officer', _is_security_officer,
    'is_worker', _is_worker
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_frequent_products(_user_id uuid, _limit integer DEFAULT 12)
 RETURNS TABLE(product_id uuid, product_name text, price numeric, image_url text, seller_id uuid, seller_name text, order_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.price, p.image_url, p.seller_id,
    sp.business_name, COUNT(*)::bigint AS order_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.buyer_id = _user_id AND o.status = 'completed' AND p.is_available = true
  GROUP BY p.id, p.name, p.price, p.image_url, p.seller_id, sp.business_name
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_society_id(_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select society_id from public.profiles where id = _user_id limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.get_visitor_types_for_society(_society_id uuid)
 RETURNS TABLE(type_key text, label text, icon text, display_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT vt.type_key, vt.label, COALESCE(vt.icon, '👤'), COALESCE(vt.display_order, 0)
  FROM public.visitor_types vt
  WHERE (vt.society_id = _society_id OR vt.society_id IS NULL) AND vt.is_active = true
  ORDER BY vt.display_order, vt.label;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _meta jsonb;
  _society_id uuid;
  _raw_society text;
  _verification_status text := 'approved';
BEGIN
  _meta := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  
  _raw_society := _meta->>'society_id';
  IF _raw_society IS NOT NULL 
     AND _raw_society != 'pending' 
     AND _raw_society ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    _society_id := _raw_society::uuid;
  ELSE
    _society_id := NULL;
  END IF;

  INSERT INTO public.profiles (
    id, email, name, phone, flat_number, block, phase, society_id, verification_status
  ) VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(_meta->>'name', _meta->>'full_name', 'User'),
    _meta->>'phone',
    COALESCE(_meta->>'flat_number', ''),
    COALESCE(_meta->>'block', ''),
    _meta->>'phase',
    _society_id,
    _verification_status
  )
  ON CONFLICT (id) DO UPDATE SET
    society_id = COALESCE(EXCLUDED.society_id, profiles.society_id),
    name = COALESCE(NULLIF(EXCLUDED.name, 'User'), profiles.name),
    phone = COALESCE(EXCLUDED.phone, profiles.phone),
    flat_number = COALESCE(NULLIF(EXCLUDED.flat_number, ''), profiles.flat_number),
    block = COALESCE(NULLIF(EXCLUDED.block, ''), profiles.block),
    phase = COALESCE(EXCLUDED.phase, profiles.phase);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'buyer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role user_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.haversine_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ))
$function$
;

CREATE OR REPLACE FUNCTION public.hold_service_slot(_slot_id uuid, _user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Clean expired holds
  DELETE FROM public.slot_holds WHERE expires_at < now();
  
  -- Check if another user holds this slot
  IF EXISTS (SELECT 1 FROM public.slot_holds WHERE slot_id = _slot_id AND user_id != _user_id AND expires_at > now()) THEN
    RETURN json_build_object('success', false, 'error', 'Slot is temporarily held by another user');
  END IF;
  
  -- Upsert hold for this user
  INSERT INTO public.slot_holds (slot_id, user_id, expires_at)
  VALUES (_slot_id, _user_id, now() + interval '5 minutes')
  ON CONFLICT DO NOTHING;
  
  RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_role(_user_id, 'admin')
$function$
;

CREATE OR REPLACE FUNCTION public.is_builder_for_society(_user_id uuid, _society_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_members bm
    JOIN public.builder_societies bs ON bs.builder_id = bm.builder_id
    WHERE bm.user_id = _user_id AND bs.society_id = _society_id AND bm.deactivated_at IS NULL
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_builder_member(_user_id uuid, _builder_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_members WHERE user_id = _user_id AND builder_id = _builder_id
  ) OR public.is_admin(_user_id)
$function$
;

CREATE OR REPLACE FUNCTION public.is_feature_enabled_for_society(_society_id uuid, _feature_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT ef.is_enabled FROM public.get_effective_society_features(_society_id) ef WHERE ef.feature_key = _feature_key LIMIT 1), false)
$function$
;

CREATE OR REPLACE FUNCTION public.is_security_officer(_user_id uuid, _society_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.security_staff
    WHERE user_id = _user_id
      AND society_id = _society_id
      AND is_active = true
      AND deactivated_at IS NULL
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_society_admin(_user_id uuid, _society_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.society_admins
    WHERE user_id = _user_id
      AND society_id = _society_id
      AND deactivated_at IS NULL
  ) OR public.is_admin(_user_id)
$function$
;

CREATE OR REPLACE FUNCTION public.log_bulletin_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, activity_type, actor_id, target_type, target_id, metadata)
    VALUES (NEW.society_id, 'bulletin_post_created', NEW.author_id, 'bulletin_post', NEW.id, jsonb_build_object('title', NEW.title, 'category', NEW.category));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Activity log bulletin %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_dispute_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, activity_type, actor_id, target_type, target_id, metadata)
    VALUES (NEW.society_id, 'dispute_created', NEW.submitted_by, 'dispute_ticket', NEW.id, jsonb_build_object('category', NEW.category));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Activity log dispute %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_help_request_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, activity_type, actor_id, target_type, target_id, metadata)
    VALUES (NEW.society_id, 'help_request_created', NEW.author_id, 'help_request', NEW.id, jsonb_build_object('tag', NEW.tag));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Activity log help %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_order_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.society_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.society_activity (society_id, activity_type, actor_id, target_type, target_id, metadata)
    VALUES (NEW.society_id, CASE WHEN TG_OP='INSERT' THEN 'order_placed' ELSE 'order_updated' END, COALESCE(NEW.buyer_id, auth.uid()), 'order', NEW.id, jsonb_build_object('status', NEW.status));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Activity log order %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_price_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO public.price_history (product_id, old_price, new_price)
    VALUES (NEW.id, OLD.price, NEW.price);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.map_transaction_type_to_action_type(_transaction_type text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE _transaction_type
    WHEN 'cart_purchase' THEN 'add_to_cart'
    WHEN 'buy_now' THEN 'buy_now'
    WHEN 'book_slot' THEN 'book'
    WHEN 'request_service' THEN 'request_service'
    WHEN 'request_quote' THEN 'request_quote'
    WHEN 'contact_only' THEN 'contact_seller'
    WHEN 'schedule_visit' THEN 'schedule_visit'
    ELSE 'add_to_cart'
  END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_upcoming_maintenance_dues()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.notification_queue (user_id, type, title, body)
  SELECT md.resident_id, 'maintenance_reminder', 'Maintenance Due Reminder',
    'Your maintenance payment of ₹' || md.amount || ' is due on ' || md.due_date
  FROM public.maintenance_dues md WHERE md.status = 'pending' AND md.due_date BETWEEN now() AND now() + interval '7 days';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_waitlist_on_slot_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _waitlisted record;
  _product_name text;
BEGIN
  IF NEW.booked_count < OLD.booked_count AND NEW.booked_count < NEW.max_capacity THEN
    SELECT * INTO _waitlisted FROM public.slot_waitlist
    WHERE slot_id = NEW.id AND notified_at IS NULL
    ORDER BY created_at LIMIT 1;
    
    IF _waitlisted IS NOT NULL THEN
      SELECT name INTO _product_name FROM public.products WHERE id = _waitlisted.product_id;
      
      INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
      VALUES (
        _waitlisted.buyer_id,
        'order',
        '🎉 Slot Available!',
        COALESCE(_product_name, 'A service') || ' slot on ' || NEW.slot_date || ' at ' || LEFT(NEW.start_time::text, 5) || ' is now available. Book now!',
        '/marketplace',
        jsonb_build_object('type', 'waitlist', 'slotId', NEW.id::text, 'productId', _waitlisted.product_id::text)
      );
      
      UPDATE public.slot_waitlist SET notified_at = now() WHERE id = _waitlisted.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rate_worker_job(_job_id uuid, _rating integer, _review text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.worker_job_requests SET worker_rating = _rating, worker_review = _review, updated_at = now()
  WHERE id = _job_id AND resident_id = auth.uid() AND status = 'completed';
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Job not found'); END IF;
  RETURN json_build_object('success', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_seller_stats(_seller_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.seller_profiles SET
    completed_order_count = (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed'),
    rating = COALESCE((SELECT AVG(rating) FROM public.reviews WHERE seller_id = _seller_id AND is_hidden = false), 0),
    total_reviews = (SELECT COUNT(*) FROM public.reviews WHERE seller_id = _seller_id AND is_hidden = false),
    cancellation_rate = CASE WHEN (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id) = 0 THEN 0
      ELSE (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'cancelled')::numeric / (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id) END,
    last_active_at = now()
  WHERE id = _seller_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_all_trust_scores()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.seller_profiles sp SET trust_score = (
    0.4 * (1 - COALESCE(sp.cancellation_rate, 0))
    + 0.3 * COALESCE(sp.repeat_customer_pct, 0) / 100.0
    + 0.2 * COALESCE(sp.on_time_delivery_pct, 0) / 100.0
    + 0.1 * LEAST(COALESCE(sp.rating, 0) / 5.0, 1)
  ) * 100
  WHERE sp.verification_status = 'approved';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_service_slot(_slot_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.service_slots
  SET booked_count = GREATEST(booked_count - 1, 0)
  WHERE id = _slot_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.release_slot_hold(_slot_id uuid, _user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.slot_holds WHERE slot_id = _slot_id AND user_id = _user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reschedule_service_booking(_booking_id uuid, _new_slot_id uuid, _new_date text, _new_start_time text, _new_end_time text, _actor_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _booking record;
  _new_slot record;
  _hours_until numeric;
  _notice_hours numeric;
  _is_seller boolean;
  _seller_user_id uuid;
  _product_name text;
BEGIN
  -- 1. Get booking with lock
  SELECT * INTO _booking
  FROM public.service_bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF _booking IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- 2. Check status allows reschedule
  IF _booking.status NOT IN ('requested', 'confirmed', 'scheduled', 'rescheduled') THEN
    RETURN json_build_object('success', false, 'error', 'Cannot reschedule a ' || _booking.status || ' booking');
  END IF;

  -- 3. Verify actor is buyer or seller
  _is_seller := EXISTS (
    SELECT 1 FROM public.seller_profiles WHERE user_id = _actor_id AND id = _booking.seller_id
  );

  IF NOT _is_seller AND _booking.buyer_id != _actor_id THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized to reschedule this booking');
  END IF;

  -- Buyer: check rescheduling notice period
  IF NOT _is_seller THEN
    SELECT sl.rescheduling_notice_hours INTO _notice_hours
    FROM public.service_listings sl
    WHERE sl.product_id = _booking.product_id;

    _hours_until := EXTRACT(EPOCH FROM (
      (_booking.booking_date + _booking.start_time) - now()
    )) / 3600;

    IF _notice_hours IS NOT NULL AND _hours_until < _notice_hours THEN
      RETURN json_build_object('success', false, 'error',
        format('Rescheduling requires at least %s hours notice', _notice_hours));
    END IF;
  END IF;

  -- 4. Prevent booking past dates
  IF _new_date::date < CURRENT_DATE THEN
    RETURN json_build_object('success', false, 'error', 'Cannot reschedule to a past date');
  END IF;

  -- 5. Prevent same-day past time
  IF _new_date::date = CURRENT_DATE AND _new_start_time::time < CURRENT_TIME THEN
    RETURN json_build_object('success', false, 'error', 'Cannot reschedule to a past time slot');
  END IF;

  -- 6. Atomically book new slot
  UPDATE public.service_slots
  SET booked_count = booked_count + 1
  WHERE id = _new_slot_id
    AND is_blocked = false
    AND booked_count < max_capacity
  RETURNING * INTO _new_slot;

  IF _new_slot IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'New slot is no longer available');
  END IF;

  -- 7. Release old slot
  IF _booking.slot_id IS NOT NULL THEN
    UPDATE public.service_slots
    SET booked_count = GREATEST(booked_count - 1, 0)
    WHERE id = _booking.slot_id;
  END IF;

  -- 8. Update booking
  UPDATE public.service_bookings
  SET slot_id = _new_slot_id,
      booking_date = _new_date::date,
      start_time = _new_start_time::time,
      end_time = _new_end_time::time,
      status = 'rescheduled',
      rescheduled_from = _booking_id,
      updated_at = now()
  WHERE id = _booking_id;

  -- 9. Update order
  UPDATE public.orders
  SET status = 'rescheduled', updated_at = now()
  WHERE id = _booking.order_id;

  -- 10. Enqueue notification to the other party
  SELECT p.name INTO _product_name FROM public.products p WHERE p.id = _booking.product_id;

  IF NOT _is_seller THEN
    -- Buyer rescheduled -> notify seller
    SELECT sp.user_id INTO _seller_user_id
    FROM public.seller_profiles sp WHERE sp.id = _booking.seller_id;

    IF _seller_user_id IS NOT NULL THEN
      INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
      VALUES (
        _seller_user_id,
        'order',
        '🔄 Booking Rescheduled',
        COALESCE(_product_name, 'A service') || ' rescheduled to ' || _new_date || ' at ' || LEFT(_new_start_time, 5),
        '/orders/' || _booking.order_id::text,
        jsonb_build_object('orderId', _booking.order_id::text, 'status', 'rescheduled', 'type', 'order')
      );
    END IF;
  ELSE
    -- Seller rescheduled -> notify buyer
    INSERT INTO public.notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      _booking.buyer_id,
      'order',
      '🔄 Your Appointment Was Rescheduled',
      COALESCE(_product_name, 'Your appointment') || ' moved to ' || _new_date || ' at ' || LEFT(_new_start_time, 5),
      '/orders/' || _booking.order_id::text,
      jsonb_build_object('orderId', _booking.order_id::text, 'status', 'rescheduled', 'type', 'order')
    );
  END IF;

  RETURN json_build_object('success', true, 'booking_id', _booking_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_marketplace(search_term text, user_society_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(seller_id uuid, user_id uuid, business_name text, description text, categories text[], primary_group text, cover_image_url text, profile_image_url text, is_available boolean, is_featured boolean, rating numeric, total_reviews integer, matching_products json)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sp.id, sp.user_id, sp.business_name, sp.description, 
    ARRAY(SELECT unnest(sp.categories)::text), sp.primary_group,
    sp.cover_image_url, sp.profile_image_url, sp.is_available, sp.is_featured, sp.rating, sp.total_reviews,
    COALESCE((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'price', p.price, 'image_url', p.image_url, 'category', p.category))
      FROM public.products p WHERE p.seller_id = sp.id AND p.is_available = true
      AND (p.name ILIKE '%' || search_term || '%' OR p.description ILIKE '%' || search_term || '%')), '[]'::json)
  FROM public.seller_profiles sp
  WHERE sp.verification_status = 'approved'
    AND (user_society_id IS NULL OR sp.society_id = user_society_id)
    AND (sp.business_name ILIKE '%' || search_term || '%'
      OR EXISTS (SELECT 1 FROM public.products p WHERE p.seller_id = sp.id AND p.is_available = true AND (p.name ILIKE '%' || search_term || '%' OR p.description ILIKE '%' || search_term || '%')))
  ORDER BY sp.is_featured DESC, sp.rating DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_nearby_sellers(_buyer_society_id uuid, _radius_km double precision DEFAULT 10, _search_term text DEFAULT NULL::text, _category text DEFAULT NULL::text)
 RETURNS TABLE(seller_id uuid, user_id uuid, business_name text, description text, categories text[], primary_group text, cover_image_url text, profile_image_url text, is_available boolean, is_featured boolean, rating numeric, total_reviews integer, matching_products json, distance_km double precision, society_name text, availability_start text, availability_end text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _lat double precision; _lng double precision;
BEGIN
  SELECT latitude, longitude INTO _lat, _lng FROM public.societies WHERE id = _buyer_society_id;
  IF _lat IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    sp.id AS seller_id,
    sp.user_id,
    sp.business_name,
    sp.description,
    ARRAY(SELECT unnest(sp.categories)::text) AS categories,
    sp.primary_group,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.is_available,
    sp.is_featured,
    sp.rating,
    sp.total_reviews,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', p.id,
        'name', p.name,
        'price', p.price,
        'image_url', p.image_url,
        'category', p.category,
        'is_veg', p.is_veg,
        'action_type', p.action_type,
        'contact_phone', p.contact_phone,
        'mrp', p.mrp,
        'discount_percentage', p.discount_percentage
      ))
      FROM public.products p
      WHERE p.seller_id = sp.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
      ), '[]'::json
    ) AS matching_products,
    public.haversine_km(_lat, _lng, s.latitude, s.longitude) AS distance_km,
    s.name AS society_name,
    sp.availability_start,
    sp.availability_end
  FROM public.seller_profiles sp
  JOIN public.societies s ON s.id = sp.society_id
  WHERE sp.verification_status = 'approved'
    AND sp.is_available = true
    AND sp.sell_beyond_community = true
    AND sp.society_id != _buyer_society_id
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND public.haversine_km(_lat, _lng, s.latitude, s.longitude) <= LEAST(_radius_km, COALESCE(sp.delivery_radius_km, _radius_km))
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.seller_id = sp.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
    )
    AND (_search_term IS NULL OR sp.business_name ILIKE '%' || _search_term || '%'
      OR EXISTS (SELECT 1 FROM public.products p2 WHERE p2.seller_id = sp.id AND p2.is_available = true AND p2.name ILIKE '%' || _search_term || '%'))
  ORDER BY public.haversine_km(_lat, _lng, s.latitude, s.longitude);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_sellers_by_location(_lat double precision, _lng double precision, _radius_km double precision DEFAULT 5, _search_term text DEFAULT NULL::text, _category text DEFAULT NULL::text, _exclude_society_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(seller_id uuid, user_id uuid, business_name text, description text, categories text[], primary_group text, cover_image_url text, profile_image_url text, is_available boolean, is_featured boolean, rating numeric, total_reviews integer, matching_products json, distance_km double precision, society_name text, availability_start time without time zone, availability_end time without time zone, seller_latitude double precision, seller_longitude double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _box_delta double precision;
  _excluded record;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN; END IF;
  _box_delta := _radius_km * 0.009;

  FOR _excluded IN
    SELECT sp.id, sp.business_name AS bname
    FROM public.seller_profiles sp
    LEFT JOIN public.societies s ON s.id = sp.society_id AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    WHERE sp.verification_status = 'approved'
      AND sp.is_available = true
      AND COALESCE(sp.latitude, s.latitude::double precision) IS NULL
  LOOP
    RAISE WARNING 'Seller excluded from discovery due to missing coordinates. seller_id=%, name=%', _excluded.id, _excluded.bname;
  END LOOP;

  RETURN QUERY
  SELECT
    sp.id AS seller_id, sp.user_id, sp.business_name, sp.description,
    ARRAY(SELECT unnest(sp.categories)::text) AS categories,
    sp.primary_group, sp.cover_image_url, sp.profile_image_url,
    sp.is_available, sp.is_featured, sp.rating, sp.total_reviews,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'image_url', p.image_url, 'category', p.category,
        'is_veg', p.is_veg, 'action_type', p.action_type,
        'contact_phone', p.contact_phone, 'mrp', p.mrp,
        'discount_percentage', p.discount_percentage
      ))
      FROM public.products p
      WHERE p.seller_id = sp.id AND p.is_available = true AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
      ), '[]'::json
    ) AS matching_products,
    public.haversine_km(_lat, _lng,
      COALESCE(sp.latitude, s.latitude::double precision),
      COALESCE(sp.longitude, s.longitude::double precision)
    ) AS distance_km,
    s.name AS society_name,
    sp.availability_start, sp.availability_end,
    COALESCE(sp.latitude, s.latitude::double precision) AS seller_latitude,
    COALESCE(sp.longitude, s.longitude::double precision) AS seller_longitude
  FROM public.seller_profiles sp
  LEFT JOIN public.societies s ON s.id = sp.society_id AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
  WHERE sp.verification_status = 'approved'
    AND sp.is_available = true
    AND COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
    AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
    AND COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
    AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
    AND public.haversine_km(_lat, _lng,
        COALESCE(sp.latitude, s.latitude::double precision),
        COALESCE(sp.longitude, s.longitude::double precision)
      ) <= LEAST(_radius_km, COALESCE(sp.delivery_radius_km, _radius_km))
    AND (_exclude_society_id IS NULL OR sp.society_id IS NULL OR sp.society_id != _exclude_society_id)
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.seller_id = sp.id AND p.is_available = true AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
    )
    AND (_search_term IS NULL OR sp.business_name ILIKE '%' || _search_term || '%'
      OR EXISTS (SELECT 1 FROM public.products p2 WHERE p2.seller_id = sp.id AND p2.is_available = true AND p2.name ILIKE '%' || _search_term || '%'))
  ORDER BY public.haversine_km(_lat, _lng,
    COALESCE(sp.latitude, s.latitude::double precision),
    COALESCE(sp.longitude, s.longitude::double precision)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_my_society_coordinates(p_lat double precision, p_lng double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _society_id uuid; _found boolean;
BEGIN
  SELECT society_id, true INTO _society_id, _found
  FROM seller_profiles WHERE user_id = auth.uid() LIMIT 1;
  
  IF NOT COALESCE(_found, false) THEN
    RAISE EXCEPTION 'No seller profile found';
  END IF;
  
  IF _society_id IS NULL THEN
    RAISE EXCEPTION 'No society assigned to your seller profile. Please update your store settings first.';
  END IF;
  
  UPDATE societies SET latitude = p_lat, longitude = p_lng
  WHERE id = _society_id AND latitude IS NULL AND longitude IS NULL;

  -- Also sync to seller_profiles for coordinate-first discovery
  UPDATE seller_profiles
  SET latitude = p_lat, longitude = p_lng, store_location_source = 'society'
  WHERE user_id = auth.uid() AND latitude IS NULL;
END; $function$
;

CREATE OR REPLACE FUNCTION public.set_my_store_coordinates(p_lat double precision, p_lng double precision, p_source text DEFAULT 'manual'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.seller_profiles
  SET latitude = p_lat, longitude = p_lng,
      store_location_source = p_source
  WHERE user_id = auth.uid();
END; $function$
;

CREATE OR REPLACE FUNCTION public.set_order_society_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.society_id IS NULL AND NEW.seller_id IS NOT NULL THEN
    SELECT society_id INTO NEW.society_id FROM public.seller_profiles WHERE id = NEW.seller_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_product_action_type_from_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tx_type text;
BEGIN
  SELECT cc.transaction_type
    INTO _tx_type
  FROM public.category_config cc
  WHERE cc.category::text = NEW.category::text
  LIMIT 1;

  NEW.action_type := public.map_transaction_type_to_action_type(_tx_type);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_products_action_type_on_category_tx_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.transaction_type IS DISTINCT FROM OLD.transaction_type THEN
    UPDATE public.products p
    SET action_type = public.map_transaction_type_to_action_type(NEW.transaction_type)
    WHERE p.category::text = NEW.category::text;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://ywhlqsgvbkvcvqlsniad.supabase.co/functions/v1/process-notification-queue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aGxxc2d2Ymt2Y3ZxbHNuaWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTY1NDEsImV4cCI6MjA4ODM3MjU0MX0.uBtwDdGBgdb3KRYPptfBV1plydCnnRq1KNLH5xVlkjI"}'::jsonb,
    body := '{}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to trigger notification processing: %', SQLERRM;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_recompute_seller_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IN ('completed', 'cancelled', 'delivered') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.recompute_seller_stats(NEW.seller_id);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_bulletin_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE public.bulletin_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN UPDATE public.bulletin_posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_bulletin_vote_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE public.bulletin_posts SET vote_count = vote_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN UPDATE public.bulletin_posts SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.seller_conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_cron_schedule(p_jobid bigint, p_schedule text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE cron.job SET schedule = p_schedule WHERE jobid = p_jobid;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_help_response_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE public.help_requests SET response_count = response_count + 1 WHERE id = NEW.request_id;
  ELSIF TG_OP = 'DELETE' THEN UPDATE public.help_requests SET response_count = GREATEST(response_count - 1, 0) WHERE id = OLD.request_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_seller_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.seller_profiles
  set
    rating = (select coalesce(avg(rating), 0) from public.reviews where seller_id = new.seller_id and is_hidden = false),
    total_reviews = (select count(*) from public.reviews where seller_id = new.seller_id and is_hidden = false)
  where id = new.seller_id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_cart_item_store_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seller_id uuid;
  v_status jsonb;
  v_status_text text;
begin
  -- Product must be orderable
  select p.seller_id
    into v_seller_id
  from public.products p
  where p.id = new.product_id
    and p.is_available = true
    and p.approval_status = 'approved';

  if v_seller_id is null then
    raise exception 'PRODUCT_NOT_ORDERABLE' using errcode = 'P0001';
  end if;

  -- Seller must be open right now
  select public.compute_store_status(
    sp.availability_start,
    sp.availability_end,
    sp.operating_days,
    coalesce(sp.is_available, true)
  )
  into v_status
  from public.seller_profiles sp
  where sp.id = v_seller_id;

  if v_status is null then
    raise exception 'SELLER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_status_text := coalesce(v_status->>'status', 'closed');
  if v_status_text <> 'open' then
    raise exception 'STORE_CLOSED:%', v_status_text using errcode = 'P0001';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_category_layout_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.layout_type NOT IN ('ecommerce', 'food', 'service') THEN
    RAISE EXCEPTION 'Invalid layout_type: %. Must be ecommerce, food, or service', NEW.layout_type;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_seller_location_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _society_lat double precision;
  _society_lng double precision;
BEGIN
  IF NEW.verification_status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.verification_status IS NOT DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;

  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.society_id IS NOT NULL THEN
    SELECT s.latitude::double precision, s.longitude::double precision
      INTO _society_lat, _society_lng
    FROM public.societies s
    WHERE s.id = NEW.society_id;

    IF _society_lat IS NOT NULL AND _society_lng IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Cannot approve seller without location coordinates. Set store location or ensure society has coordinates.';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_session_feedback_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_society_admin_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _max int; _cur int;
BEGIN
  SELECT COALESCE(max_society_admins, 5) INTO _max FROM public.societies WHERE id = NEW.society_id;
  SELECT COUNT(*) INTO _cur FROM public.society_admins WHERE society_id = NEW.society_id AND deactivated_at IS NULL;
  IF _cur >= _max THEN RAISE EXCEPTION 'Society admin limit (%) reached', _max; END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_worker_entry(_worker_id uuid, _society_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _worker record; _result json;
BEGIN
  SELECT * INTO _worker FROM public.society_workers WHERE id = _worker_id AND society_id = _society_id AND is_active = true;
  IF NOT FOUND THEN RETURN json_build_object('valid', false, 'reason', 'Worker not found or inactive'); END IF;
  RETURN json_build_object('valid', true, 'worker_name', _worker.name, 'worker_type', _worker.worker_type, 'worker_id', _worker.id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_seller_payment(_order_id uuid, _received boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _order record;
  _seller_user_id uuid;
BEGIN
  -- Fetch order
  SELECT id, seller_id, payment_status
  INTO _order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Verify caller is the seller
  SELECT user_id INTO _seller_user_id
  FROM public.seller_profiles
  WHERE id = _order.seller_id;

  IF _seller_user_id IS NULL OR _seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.payment_status != 'buyer_confirmed' THEN
    RAISE EXCEPTION 'No pending payment confirmation for this order';
  END IF;

  -- Update payment verification
  UPDATE public.orders
  SET payment_status = CASE WHEN _received THEN 'paid' ELSE 'disputed' END,
      payment_confirmed_by_seller = _received,
      payment_confirmed_at = now(),
      updated_at = now()
  WHERE id = _order_id;
END;
$function$
;]]