or', 'Not authenticated');
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
