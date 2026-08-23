-- P0: Scheduled orders placed inside the cancel window (or after slot time)
-- previously got cancellation_cutoff_at already in the past, so buyer cancel
-- always failed with a generic toast.

CREATE OR REPLACE FUNCTION public.trg_orders_compute_scheduled_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_times record;
  v_grace interval := interval '15 minutes';
BEGIN
  IF NEW.scheduled_date IS NULL THEN
    NEW.preparation_start_at := NULL;
    NEW.scheduled_fulfilment_at := NULL;
    NEW.cancellation_cutoff_at := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_times
  FROM public.compute_scheduled_order_times(
    NEW.scheduled_date,
    COALESCE(NEW.scheduled_time_start, NEW.scheduled_time, time '12:00')
  );

  NEW.scheduled_fulfilment_at := v_times.scheduled_fulfilment_at;
  NEW.preparation_start_at := v_times.preparation_start_at;
  NEW.cancellation_cutoff_at := v_times.cancellation_cutoff_at;

  -- Block scheduling more than 30 minutes in the past (clock skew / stale UI).
  IF TG_OP = 'INSERT'
     AND NEW.scheduled_fulfilment_at IS NOT NULL
     AND NEW.scheduled_fulfilment_at < (now() - interval '30 minutes') THEN
    RAISE EXCEPTION 'Scheduled time is in the past. Choose a later slot.';
  END IF;

  -- Same-day / late booking: never stamp a cutoff that is already expired at
  -- placement. Keep cancel open for a short grace, capped by prep start.
  IF NEW.cancellation_cutoff_at IS NOT NULL AND NEW.cancellation_cutoff_at <= now() THEN
    NEW.cancellation_cutoff_at := LEAST(
      COALESCE(NEW.preparation_start_at, NEW.scheduled_fulfilment_at, now() + v_grace),
      now() + v_grace
    );
    IF NEW.cancellation_cutoff_at <= now() THEN
      NEW.cancellation_cutoff_at := now() + v_grace;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Heal buyer_cancel_order messaging + allow cancel when cutoff was already
-- expired at created_at (legacy rows) while still pre-fulfilment.
CREATE OR REPLACE FUNCTION public.buyer_cancel_order(
  _order_id uuid,
  _reason text DEFAULT NULL::text,
  _expected_status order_status DEFAULT NULL::order_status
)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _updated public.orders;
  _clean_reason text;
  _current_status text;
  _seller_group text;
  _order_type text;
  _fulfillment_type text;
  _delivery_handled_by text;
  _txn_type text;
  _listing_type text;
  _payment_status text;
  _v_refund_amount numeric;
  _v_dest text := 'original_payment';
  _v_payment_id text;
  _cancellation_cutoff timestamptz;
  _created_at timestamptz;
  _prep_start timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT o.status, sp.primary_group, o.order_type, o.fulfillment_type, o.delivery_handled_by,
         o.payment_status, o.cancellation_cutoff_at, o.created_at, o.preparation_start_at
  INTO _current_status, _seller_group, _order_type, _fulfillment_type, _delivery_handled_by,
       _payment_status, _cancellation_cutoff, _created_at, _prep_start
  FROM public.orders o
  LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id AND o.buyer_id = auth.uid();

  IF _current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found or not yours';
  END IF;

  IF _expected_status IS NOT NULL AND _current_status != _expected_status::text THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  -- Cutoff enforcement: skip when the row was born with an already-expired cutoff
  -- (legacy same-day bug) and the order is still in a pre-fulfilment buyer-cancelable state.
  IF _cancellation_cutoff IS NOT NULL
     AND now() >= _cancellation_cutoff
     AND NOT (
       _created_at IS NOT NULL
       AND _cancellation_cutoff <= _created_at
       AND _current_status IN ('placed', 'pending', 'accepted', 'confirmed', 'scheduled', 'requested', 'booked', 'rescheduled')
       AND (_prep_start IS NULL OR now() < _prep_start + interval '15 minutes')
     ) THEN
    RAISE EXCEPTION 'Cancellation cutoff has passed for this scheduled order';
  END IF;

  SELECT p.listing_type INTO _listing_type
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = _order_id
  LIMIT 1;

  IF _order_type = 'enquiry' THEN
    _txn_type := public.resolve_enquiry_transaction_type(_listing_type);
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

  _txn_type := public.heal_enquiry_transaction_type(_order_type, _listing_type, _txn_type);

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

  PERFORM set_config('app.acting_as', 'buyer', true);

  UPDATE public.orders
  SET
    status = 'cancelled',
    transaction_type = COALESCE(_txn_type, transaction_type),
    rejection_reason = 'Cancelled by buyer: ' || _clean_reason,
    failure_owner = COALESCE(failure_owner, 'buyer'),
    updated_at = now(),
    auto_cancel_at = null
  WHERE id = _order_id
    AND buyer_id = auth.uid()
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Order not found, not owned by user, or status changed';
  END IF;

  IF _current_status = 'placed'
     AND _payment_status IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed')
     AND NOT EXISTS (
       SELECT 1 FROM public.refund_requests rr
       WHERE rr.order_id = _order_id
         AND rr.status NOT IN ('rejected')
         AND COALESCE(rr.refund_state, '') NOT IN ('rejected')
     ) THEN
    _v_refund_amount := public.compute_child_gateway_refund_amount(_order_id);
    IF _v_refund_amount IS NOT NULL AND _v_refund_amount > 0 THEN
      _v_payment_id := NULLIF(_updated.razorpay_payment_id, '');
      IF _v_payment_id IS NULL AND _updated.checkout_group_id IS NOT NULL THEN
        SELECT NULLIF(cg.razorpay_payment_id, '') INTO _v_payment_id
        FROM public.checkout_groups cg
        WHERE cg.id = _updated.checkout_group_id;
      END IF;
      IF _v_payment_id IS NULL THEN
        _v_dest := 'wallet';
      END IF;

      INSERT INTO public.refund_requests (
        order_id, buyer_id, seller_id, society_id, amount, reason, category,
        status, refund_state, auto_approved, approved_at, refund_destination,
        wallet_credit_amount
      ) VALUES (
        _updated.id,
        _updated.buyer_id,
        _updated.seller_id,
        _updated.society_id,
        _v_refund_amount,
        'Buyer cancelled before seller acceptance',
        'buyer_cancelled',
        'approved',
        'approved',
        true,
        now(),
        _v_dest,
        CASE WHEN _v_dest = 'wallet' THEN _v_refund_amount ELSE 0 END
      );

      UPDATE public.orders
      SET payment_status = 'refund_initiated', updated_at = now()
      WHERE id = _updated.id;

      SELECT * INTO _updated FROM public.orders WHERE id = _order_id;
    END IF;
  END IF;

  RETURN _updated;
END;
$function$;
