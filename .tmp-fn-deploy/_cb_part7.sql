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