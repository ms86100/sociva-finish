-- Chat + bookable-service production hardening
-- C1: unify chat notify type/path on trigger
-- C3: unique seller conversations
-- C4: auth-bind book/release slot RPCs
-- C5: cross-user notification enqueue helper (SECURITY DEFINER)
-- C6: can_cancel_booking returns fee_percentage + cancel_fee
-- C8: atomic create_service_booking_atomic
-- H3: release slot when booking order cancelled via sync
-- H4: reschedule_service_booking RPC

-- ============================================================
-- C1: Chat notification trigger — single canonical type + deep link
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_chat_message_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order_status TEXT;
  _sender_name TEXT;
BEGIN
  SELECT status INTO _order_status FROM orders WHERE id = NEW.order_id;
  IF _order_status IS NULL OR _order_status IN ('cancelled', 'completed', 'rejected', 'refunded') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(name, 'Someone') INTO _sender_name FROM profiles WHERE id = NEW.sender_id;

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    NEW.receiver_id,
    'New message',
    _sender_name || ': ' || LEFT(NEW.message_text, 100),
    'chat',
    '/orders/' || NEW.order_id::text || '?chat=1',
    jsonb_build_object(
      'type', 'chat',
      'orderId', NEW.order_id,
      'order_id', NEW.order_id,
      'entity_type', 'order',
      'entity_id', NEW.order_id,
      'sender_id', NEW.sender_id
    )
  );

  RETURN NEW;
END;
$function$;

-- ============================================================
-- C5: Safe cross-user enqueue (caller may only enqueue for self OR
--     for chat/order/booking recipients they are party to)
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_user_notification(
  _user_id uuid,
  _type text,
  _title text,
  _body text,
  _reference_path text DEFAULT NULL,
  _payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _qid uuid;
  _allowed boolean := false;
  _order_id uuid;
  _conv_id uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _user_id = _caller THEN
    _allowed := true;
  ELSIF _type IN ('chat', 'chat_message', 'message') THEN
    -- Party to an order chat, or seller/buyer on a product conversation
    _order_id := NULLIF((_payload->>'orderId'), '')::uuid;
    IF _order_id IS NULL THEN
      _order_id := NULLIF((_payload->>'order_id'), '')::uuid;
    END IF;
    IF _order_id IS NULL AND _reference_path ~ '/orders/([0-9a-f-]{36})' THEN
      _order_id := (regexp_match(_reference_path, '/orders/([0-9a-f-]{36})'))[1]::uuid;
    END IF;

    IF _order_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = _order_id
          AND (
            o.buyer_id = _caller
            OR o.seller_id IN (SELECT id FROM seller_profiles WHERE user_id = _caller)
          )
          AND (
            o.buyer_id = _user_id
            OR o.seller_id IN (SELECT id FROM seller_profiles WHERE user_id = _user_id)
            OR EXISTS (SELECT 1 FROM seller_profiles sp WHERE sp.user_id = _user_id AND sp.id = o.seller_id)
          )
      ) INTO _allowed;
    END IF;

    IF NOT _allowed THEN
      _conv_id := NULLIF((_payload->>'conversationId'), '')::uuid;
      IF _conv_id IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1 FROM seller_conversations sc
          JOIN seller_profiles sp ON sp.id = sc.seller_id
          WHERE sc.id = _conv_id
            AND (
              (sc.buyer_id = _caller AND sp.user_id = _user_id)
              OR (sp.user_id = _caller AND sc.buyer_id = _user_id)
            )
        ) INTO _allowed;
      END IF;
    END IF;
  ELSIF _type IN ('order', 'booking', 'booking_confirmed', 'booking_cancelled', 'booking_rescheduled') THEN
    _order_id := NULLIF((_payload->>'orderId'), '')::uuid;
    IF _order_id IS NULL THEN
      _order_id := NULLIF((_payload->>'order_id'), '')::uuid;
    END IF;
    IF _order_id IS NULL AND _reference_path ~ '/orders/([0-9a-f-]{36})' THEN
      _order_id := (regexp_match(_reference_path, '/orders/([0-9a-f-]{36})'))[1]::uuid;
    END IF;
    IF _order_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.id = _order_id
          AND (
            o.buyer_id = _caller
            OR o.seller_id IN (SELECT id FROM seller_profiles WHERE user_id = _caller)
          )
          AND (
            o.buyer_id = _user_id
            OR EXISTS (SELECT 1 FROM seller_profiles sp WHERE sp.user_id = _user_id AND sp.id = o.seller_id)
          )
      ) INTO _allowed;
    END IF;
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Not allowed to enqueue notification for this user';
  END IF;

  INSERT INTO notification_queue (user_id, type, title, body, reference_path, payload)
  VALUES (_user_id, _type, _title, LEFT(COALESCE(_body, ''), 500), _reference_path, _payload)
  RETURNING id INTO _qid;

  RETURN _qid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_user_notification(uuid, text, text, text, text, jsonb) TO authenticated;

-- ============================================================
-- C3: Dedupe + UNIQUE on seller_conversations
-- ============================================================
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY buyer_id, seller_id, product_id
           ORDER BY COALESCE(last_message_at, created_at) DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM seller_conversations
)
DELETE FROM seller_conversation_messages m
USING ranked r
WHERE m.conversation_id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY buyer_id, seller_id, product_id
           ORDER BY COALESCE(last_message_at, created_at) DESC NULLS LAST, created_at DESC
         ) AS rn
  FROM seller_conversations
)
DELETE FROM seller_conversations sc
USING ranked r
WHERE sc.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_conversations_buyer_seller_product
  ON public.seller_conversations (buyer_id, seller_id, product_id);

-- ============================================================
-- C4: book_service_slot — bind buyer to auth.uid()
-- ============================================================
CREATE OR REPLACE FUNCTION public.book_service_slot(
  _order_id uuid,
  _slot_id uuid,
  _buyer_id uuid,
  _seller_id uuid,
  _product_id uuid,
  _booking_date text,
  _start_time text,
  _end_time text,
  _location_type text DEFAULT 'at_seller'::text,
  _buyer_address text DEFAULT NULL::text,
  _notes text DEFAULT NULL::text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _slot record;
  _booking_id uuid;
  _existing_count int;
  _caller uuid := auth.uid();
  _order record;
BEGIN
  IF _caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF _buyer_id IS DISTINCT FROM _caller THEN
    RETURN json_build_object('success', false, 'error', 'Buyer mismatch');
  END IF;

  SELECT * INTO _order FROM orders WHERE id = _order_id;
  IF _order IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Order not found');
  END IF;
  IF _order.buyer_id IS DISTINCT FROM _caller THEN
    RETURN json_build_object('success', false, 'error', 'Not your order');
  END IF;
  IF _order.seller_id IS DISTINCT FROM _seller_id THEN
    RETURN json_build_object('success', false, 'error', 'Seller mismatch');
  END IF;

  SELECT COUNT(*) INTO _existing_count
  FROM public.service_bookings
  WHERE buyer_id = _buyer_id
    AND slot_id = _slot_id
    AND status NOT IN ('cancelled', 'no_show');

  IF _existing_count > 0 THEN
    RETURN json_build_object('success', false, 'error', 'You already have a booking for this time slot');
  END IF;

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

  IF _booking_date::date < CURRENT_DATE THEN
    RETURN json_build_object('success', false, 'error', 'Cannot book a past date');
  END IF;

  IF _booking_date::date = CURRENT_DATE AND _start_time::time < CURRENT_TIME THEN
    RETURN json_build_object('success', false, 'error', 'This time slot has already passed');
  END IF;

  UPDATE public.service_slots
  SET booked_count = booked_count + 1
  WHERE id = _slot_id
    AND is_blocked = false
    AND booked_count < max_capacity
  RETURNING * INTO _slot;

  IF _slot IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Slot is no longer available');
  END IF;

  INSERT INTO public.service_bookings (
    order_id, slot_id, buyer_id, seller_id, product_id,
    booking_date, start_time, end_time, status, location_type, buyer_address, notes
  ) VALUES (
    _order_id, _slot_id, _buyer_id, _seller_id, _product_id,
    _booking_date::date, _start_time::time, _end_time::time, 'confirmed',
    _location_type, _buyer_address, _notes
  )
  RETURNING id INTO _booking_id;

  RETURN json_build_object('success', true, 'booking_id', _booking_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================
-- C4: release_service_slot — ownership / party check
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_service_slot(_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _ok boolean := false;
  _role text := coalesce(auth.role(), '');
BEGIN
  -- Edge functions / cron use the service_role key (auth.uid() is null).
  IF _role = 'service_role' THEN
    UPDATE public.service_slots
    SET booked_count = GREATEST(booked_count - 1, 0)
    WHERE id = _slot_id;
    RETURN;
  END IF;

  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM service_slots ss
    LEFT JOIN seller_profiles sp ON sp.id = ss.seller_id
    WHERE ss.id = _slot_id
      AND (
        sp.user_id = _caller
        OR EXISTS (
          SELECT 1 FROM service_bookings sb
          WHERE sb.slot_id = _slot_id
            AND sb.buyer_id = _caller
            AND sb.status IN ('cancelled', 'confirmed', 'requested', 'scheduled', 'rescheduled')
        )
      )
  ) INTO _ok;

  IF NOT _ok THEN
    RAISE EXCEPTION 'Not allowed to release this slot';
  END IF;

  UPDATE public.service_slots
  SET booked_count = GREATEST(booked_count - 1, 0)
  WHERE id = _slot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_service_slot(uuid) TO authenticated, service_role;

-- ============================================================
-- H3: Sync booking status + release slot on cancel
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_booking_status_on_order_update_impl(p_old orders, p_new orders)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _booking record;
BEGIN
  IF p_new.status IS DISTINCT FROM p_old.status
     AND (p_new.order_type = 'booking' OR p_new.transaction_type IN ('service_booking', 'request_service')) THEN
    UPDATE public.service_bookings
    SET status = p_new.status::text,
        updated_at = now(),
        cancelled_at = CASE
          WHEN p_new.status::text IN ('cancelled', 'rejected') THEN COALESCE(cancelled_at, now())
          ELSE cancelled_at
        END
    WHERE order_id = p_new.id;

    IF p_new.status::text IN ('cancelled', 'rejected')
       AND p_old.status::text IS DISTINCT FROM p_new.status::text THEN
      FOR _booking IN
        SELECT id, slot_id FROM service_bookings
        WHERE order_id = p_new.id AND slot_id IS NOT NULL
      LOOP
        UPDATE public.service_slots
        SET booked_count = GREATEST(booked_count - 1, 0)
        WHERE id = _booking.slot_id;
      END LOOP;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- C6: can_cancel_booking — both fee keys + seller via profile
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_cancel_booking(_booking_id uuid, _actor_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _booking record;
  _hours_until numeric;
  _fee numeric := 0;
  _caller uuid := auth.uid();
  _is_seller boolean := false;
BEGIN
  IF _caller IS NULL OR _actor_id IS DISTINCT FROM _caller THEN
    RETURN json_build_object('can_cancel', false, 'cancel_fee', 0, 'fee_percentage', 0, 'reason', 'Not authenticated');
  END IF;

  SELECT sb.*, sl.cancellation_notice_hours, sl.cancellation_fee_percentage
  INTO _booking
  FROM service_bookings sb
  LEFT JOIN service_listings sl ON sl.product_id = sb.product_id
  WHERE sb.id = _booking_id;

  IF _booking IS NULL THEN
    RETURN json_build_object('can_cancel', false, 'cancel_fee', 0, 'fee_percentage', 0, 'reason', 'Booking not found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM seller_profiles sp
    WHERE sp.id = _booking.seller_id AND sp.user_id = _caller
  ) INTO _is_seller;

  IF _booking.buyer_id IS DISTINCT FROM _caller AND NOT _is_seller THEN
    RETURN json_build_object('can_cancel', false, 'cancel_fee', 0, 'fee_percentage', 0, 'reason', 'Not authorized');
  END IF;

  IF _booking.status IN ('cancelled', 'completed', 'no_show', 'in_progress') THEN
    RETURN json_build_object('can_cancel', false, 'cancel_fee', 0, 'fee_percentage', 0, 'reason', 'Booking can no longer be cancelled');
  END IF;

  IF _is_seller THEN
    RETURN json_build_object('can_cancel', true, 'cancel_fee', 0, 'fee_percentage', 0, 'reason', 'Seller cancellation');
  END IF;

  _hours_until := EXTRACT(EPOCH FROM (
    (_booking.booking_date::timestamp + _booking.start_time) - now()
  )) / 3600.0;

  IF _booking.cancellation_notice_hours IS NOT NULL
     AND _hours_until < _booking.cancellation_notice_hours THEN
    IF COALESCE(_booking.cancellation_fee_percentage, 0) > 0 THEN
      _fee := _booking.cancellation_fee_percentage;
      RETURN json_build_object(
        'can_cancel', true,
        'cancel_fee', _fee,
        'fee_percentage', _fee,
        'reason', 'Within cancellation notice window — fee applies'
      );
    END IF;
  END IF;

  RETURN json_build_object('can_cancel', true, 'cancel_fee', 0, 'fee_percentage', 0, 'reason', 'Within cancellation window');
END;
$$;

-- ============================================================
-- C8: Atomic booking create
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_service_booking_atomic(
  _seller_id uuid,
  _product_id uuid,
  _slot_id uuid,
  _booking_date text,
  _start_time text,
  _end_time text,
  _total_amount numeric,
  _product_name text,
  _unit_price numeric,
  _idempotency_key text,
  _notes text DEFAULT NULL,
  _buyer_address text DEFAULT NULL,
  _location_type text DEFAULT 'at_seller',
  _fulfillment_type text DEFAULT NULL,
  _addons jsonb DEFAULT '[]'::jsonb,
  _recurring jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _order_id uuid;
  _booking_id uuid;
  _slot_result json;
  _addon jsonb;
  _existing_order uuid;
  _seller_user uuid;
BEGIN
  IF _caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM seller_profiles WHERE id = _seller_id AND user_id = _caller) THEN
    RETURN json_build_object('success', false, 'error', 'Cannot book your own service');
  END IF;

  SELECT id INTO _existing_order
  FROM orders
  WHERE buyer_id = _caller AND idempotency_key = _idempotency_key
  LIMIT 1;

  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object(
      'success', true,
      'order_id', _existing_order,
      'booking_id', _booking_id,
      'idempotent', true
    );
  END IF;

  INSERT INTO orders (
    buyer_id, seller_id, total_amount, order_type, status,
    payment_type, payment_status, transaction_type, idempotency_key,
    notes, delivery_address, fulfillment_type
  ) VALUES (
    _caller, _seller_id, _total_amount, 'booking', 'confirmed',
    'cod', 'pending', 'service_booking', _idempotency_key,
    NULLIF(LEFT(COALESCE(_notes, ''), 500), ''),
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    COALESCE(_fulfillment_type, _location_type, 'at_seller')
  )
  RETURNING id INTO _order_id;

  INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
  VALUES (_order_id, _product_id, _product_name, 1, _unit_price);

  _slot_result := public.book_service_slot(
    _order_id, _slot_id, _caller, _seller_id, _product_id,
    _booking_date, _start_time, _end_time,
    COALESCE(_location_type, 'at_seller'),
    NULLIF(LEFT(COALESCE(_buyer_address, ''), 300), ''),
    NULLIF(LEFT(COALESCE(_notes, ''), 500), '')
  );

  IF COALESCE((_slot_result->>'success')::boolean, false) IS NOT TRUE THEN
    UPDATE orders SET status = 'cancelled', notes = COALESCE(notes, '') || ' [booking_setup_failed]'
    WHERE id = _order_id;
    RETURN json_build_object(
      'success', false,
      'error', COALESCE(_slot_result->>'error', 'Failed to book slot'),
      'order_id', _order_id
    );
  END IF;

  _booking_id := (_slot_result->>'booking_id')::uuid;

  IF _addons IS NOT NULL AND jsonb_typeof(_addons) = 'array' THEN
    FOR _addon IN SELECT * FROM jsonb_array_elements(_addons)
    LOOP
      INSERT INTO service_booking_addons (booking_id, addon_id, addon_name, addon_price)
      VALUES (
        _booking_id,
        NULLIF(_addon->>'id', '')::uuid,
        COALESCE(_addon->>'name', 'Add-on'),
        COALESCE((_addon->>'price')::numeric, 0)
      );
    END LOOP;
  END IF;

  IF _recurring IS NOT NULL AND COALESCE((_recurring->>'enabled')::boolean, false) THEN
    INSERT INTO service_recurring_configs (
      booking_id, buyer_id, seller_id, product_id,
      frequency, preferred_time, start_date, end_date, day_of_week
    ) VALUES (
      _booking_id, _caller, _seller_id, _product_id,
      COALESCE(_recurring->>'frequency', 'weekly'),
      _start_time::time,
      _booking_date::date,
      NULLIF(_recurring->>'endDate', '')::date,
      COALESCE((_recurring->>'dayOfWeek')::int, EXTRACT(DOW FROM _booking_date::date)::int)
    );
  END IF;

  SELECT user_id INTO _seller_user FROM seller_profiles WHERE id = _seller_id;
  IF _seller_user IS NOT NULL THEN
    INSERT INTO notification_queue (user_id, type, title, body, reference_path, payload)
    VALUES (
      _seller_user,
      'order',
      'New Booking Confirmed',
      'A customer booked ' || _product_name || ' on ' || _booking_date || ' at ' || LEFT(_start_time, 5),
      '/orders/' || _order_id::text,
      jsonb_build_object('orderId', _order_id, 'status', 'confirmed', 'type', 'order')
    );
  END IF;

  RETURN json_build_object(
    'success', true,
    'order_id', _order_id,
    'booking_id', _booking_id,
    'idempotent', false
  );
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO _existing_order
  FROM orders WHERE buyer_id = _caller AND idempotency_key = _idempotency_key LIMIT 1;
  IF _existing_order IS NOT NULL THEN
    SELECT id INTO _booking_id FROM service_bookings WHERE order_id = _existing_order LIMIT 1;
    RETURN json_build_object('success', true, 'order_id', _existing_order, 'booking_id', _booking_id, 'idempotent', true);
  END IF;
  RETURN json_build_object('success', false, 'error', SQLERRM);
WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_service_booking_atomic(
  uuid, uuid, uuid, text, text, text, numeric, text, numeric, text, text, text, text, text, jsonb, jsonb
) TO authenticated;

-- ============================================================
-- H4: reschedule_service_booking
-- ============================================================
CREATE OR REPLACE FUNCTION public.reschedule_service_booking(
  _booking_id uuid,
  _new_slot_id uuid,
  _new_date text,
  _new_start_time text,
  _new_end_time text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid := auth.uid();
  _booking record;
  _old_slot uuid;
  _is_seller boolean := false;
  _new_slot record;
BEGIN
  IF _caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO _booking FROM service_bookings WHERE id = _booking_id FOR UPDATE;
  IF _booking IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Booking not found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM seller_profiles sp WHERE sp.id = _booking.seller_id AND sp.user_id = _caller
  ) INTO _is_seller;

  IF _booking.buyer_id IS DISTINCT FROM _caller AND NOT _is_seller THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF _booking.status IN ('cancelled', 'completed', 'no_show', 'in_progress') THEN
    RETURN json_build_object('success', false, 'error', 'Booking cannot be rescheduled');
  END IF;

  IF _new_date::date < CURRENT_DATE THEN
    RETURN json_build_object('success', false, 'error', 'Cannot reschedule to a past date');
  END IF;

  _old_slot := _booking.slot_id;

  UPDATE public.service_slots
  SET booked_count = booked_count + 1
  WHERE id = _new_slot_id
    AND is_blocked = false
    AND booked_count < max_capacity
  RETURNING * INTO _new_slot;

  IF _new_slot IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'New slot is no longer available');
  END IF;

  UPDATE public.service_bookings
  SET slot_id = _new_slot_id,
      booking_date = _new_date::date,
      start_time = _new_start_time::time,
      end_time = _new_end_time::time,
      status = 'rescheduled',
      rescheduled_from = COALESCE(rescheduled_from, _booking.id),
      updated_at = now()
  WHERE id = _booking_id;

  IF _old_slot IS NOT NULL AND _old_slot IS DISTINCT FROM _new_slot_id THEN
    UPDATE public.service_slots
    SET booked_count = GREATEST(booked_count - 1, 0)
    WHERE id = _old_slot;
  END IF;

  IF _booking.order_id IS NOT NULL THEN
    UPDATE orders SET status = 'rescheduled', updated_at = now() WHERE id = _booking.order_id;
  END IF;

  RETURN json_build_object('success', true, 'booking_id', _booking_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_service_booking(uuid, uuid, text, text, text) TO authenticated;

-- Drop legacy atomic overload (different arg shape) to avoid PostgREST ambiguity
DROP FUNCTION IF EXISTS public.create_service_booking_atomic(uuid, uuid, uuid, date, time, time, text, text, text, text, uuid[], jsonb, text);
