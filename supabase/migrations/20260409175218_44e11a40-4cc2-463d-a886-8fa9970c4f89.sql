
CREATE OR REPLACE FUNCTION public.book_service_slot(_order_id uuid, _slot_id uuid, _buyer_id uuid, _seller_id uuid, _product_id uuid, _booking_date text, _start_time text, _end_time text, _location_type text DEFAULT 'at_seller'::text, _buyer_address text DEFAULT NULL::text, _notes text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _slot record;
  _booking_id uuid;
  _existing_count int;
BEGIN
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

CREATE OR REPLACE FUNCTION public.buyer_advance_order(_order_id uuid, _new_status public.order_status) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_valid BOOLEAN;
  v_listing_type TEXT;
BEGIN
  SELECT o.id, o.status, o.buyer_id, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         o.payment_type, o.payment_status,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized — you are not the buyer of this order';
  END IF;

  v_parent_group := COALESCE(v_order.primary_group, 'default');

  SELECT cc.transaction_type INTO v_listing_type
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN category_config cc ON cc.category::text = p.category
  WHERE oi.order_id = _order_id
  LIMIT 1;

  IF v_listing_type = 'contact_only' THEN
    v_transaction_type := 'contact_enquiry';
  ELSIF v_order.order_type = 'enquiry' THEN
    IF v_parent_group IN ('classes', 'events') THEN
      v_transaction_type := 'service_booking';
    ELSE
      v_transaction_type := 'request_service';
    END IF;
  ELSIF v_order.order_type = 'booking' THEN
    v_transaction_type := 'service_booking';
  ELSIF v_order.fulfillment_type = 'self_pickup' THEN
    v_transaction_type := 'self_fulfillment';
  ELSIF v_order.fulfillment_type = 'seller_delivery' THEN
    v_transaction_type := 'seller_delivery';
  ELSIF v_order.fulfillment_type = 'delivery' AND (v_order.delivery_handled_by IS NULL OR v_order.delivery_handled_by = 'seller') THEN
    v_transaction_type := 'seller_delivery';
  ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
    v_transaction_type := 'cart_purchase';
  ELSE
    v_transaction_type := 'self_fulfillment';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text
      AND to_status = _new_status::text
      AND allowed_actor = 'buyer'
      AND (
        (parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type)
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid buyer transition from % to %', v_order.status, _new_status;
  END IF;

  PERFORM set_config('app.acting_as', 'buyer', true);

  IF _new_status::text = 'completed' AND v_order.payment_type = 'cod' AND COALESCE(v_order.payment_status, 'pending') <> 'paid' THEN
    UPDATE orders
    SET status = _new_status,
        payment_status = 'paid',
        payment_confirmed_at = now(),
        buyer_confirmed_at = now(),
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  ELSE
    UPDATE orders
    SET status = _new_status,
        buyer_confirmed_at = CASE WHEN _new_status::text = 'completed' THEN now() ELSE buyer_confirmed_at END,
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.buyer_cancel_order(_order_id uuid, _reason text DEFAULT NULL::text, _expected_status public.order_status DEFAULT NULL::public.order_status) RETURNS public.orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _updated public.orders;
  _clean_reason text;
  _current_status text;
  _seller_group text;
  _order_type text;
  _fulfillment_type text;
  _delivery_handled_by text;
  _txn_type text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT o.status, sp.primary_group, o.order_type, o.fulfillment_type, o.delivery_handled_by
  INTO _current_status, _seller_group, _order_type, _fulfillment_type, _delivery_handled_by
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id AND o.buyer_id = auth.uid();

  IF _current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found or not yours';
  END IF;

  IF _expected_status IS NOT NULL AND _current_status != _expected_status::text THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  IF _order_type = 'enquiry' THEN
    IF coalesce(_seller_group, 'default') IN ('classes', 'events') THEN
      _txn_type := 'book_slot';
    ELSE
      _txn_type := 'request_service';
    END IF;
  ELSIF _order_type = 'booking' THEN
    _txn_type := 'service_booking';
  ELSIF _fulfillment_type = 'self_pickup' THEN
    _txn_type := 'self_fulfillment';
  ELSIF _fulfillment_type = 'seller_delivery' THEN
    _txn_type := 'seller_delivery';
  ELSIF _fulfillment_type = 'delivery' AND coalesce(_delivery_handled_by, 'seller') = 'seller' THEN
    _txn_type := 'seller_delivery';
  ELSIF _fulfillment_type = 'delivery' AND _delivery_handled_by = 'platform' THEN
    _txn_type := 'cart_purchase';
  ELSE
    _txn_type := 'self_fulfillment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE from_status = _current_status
      AND to_status = 'cancelled'
      AND allowed_actor = 'buyer'
      AND parent_group = coalesce(_seller_group, 'default')
      AND transaction_type = _txn_type
  ) AND NOT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE from_status = _current_status
      AND to_status = 'cancelled'
      AND allowed_actor = 'buyer'
      AND parent_group = 'default'
      AND transaction_type = _txn_type
  ) THEN
    RAISE EXCEPTION 'Invalid status transition';
  END IF;

  _clean_reason := left(coalesce(nullif(btrim(_reason), ''), 'Cancelled by buyer'), 500);

  UPDATE public.orders
  SET
    status = 'cancelled',
    rejection_reason = 'Cancelled by buyer: ' || _clean_reason,
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = _order_id
    AND buyer_id = auth.uid()
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  RETURN _updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_cancel_booking(_booking_id uuid, _actor_id uuid) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  _is_seller := (_actor_id = _booking.seller_id);

  IF NOT _is_seller AND _actor_id != _booking.buyer_id THEN
    RETURN json_build_object('can_cancel', false, 'reason', 'Not authorized');
  END IF;

  -- Sellers can always cancel
  IF _is_seller THEN
    RETURN json_build_object('can_cancel', true, 'cancel_fee', 0, 'reason', 'Seller cancellation');
  END IF;

  -- Calculate hours until booking
  _hours_until := EXTRACT(EPOCH FROM (
    (_booking.booking_date + _booking.start_time) - now()
  )) / 3600;

  IF _hours_until < 0 THEN
    RETURN json_build_object('can_cancel', false, 'reason', 'Booking time has passed');
  END IF;

  -- Check cancellation notice period
  IF _booking.cancellation_notice_hours IS NOT NULL AND _hours_until < _booking.cancellation_notice_hours THEN
    IF _booking.cancellation_fee_percentage IS NOT NULL AND _booking.cancellation_fee_percentage > 0 THEN
      RETURN json_build_object(
        'can_cancel', true,
        'cancel_fee', _booking.cancellation_fee_percentage,
        'reason', 'Late cancellation fee applies'
      );
    END IF;
  END IF;

  RETURN json_build_object('can_cancel', true, 'cancel_fee', 0, 'reason', 'Within cancellation window');
END;
$$;
