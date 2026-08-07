-- Fix: reschedule_service_booking updates orders.status without app.acting_as,
-- which fails the fail-closed validate_order_status_transition trigger.
-- Set acting_as to buyer or seller based on caller before the order update.

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
AS $function$
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
    -- Fail-closed order status gate requires explicit actor.
    PERFORM set_config('app.acting_as', CASE WHEN _is_seller THEN 'seller' ELSE 'buyer' END, true);
    UPDATE orders SET status = 'rescheduled', updated_at = now() WHERE id = _booking.order_id;
  END IF;

  RETURN json_build_object('success', true, 'booking_id', _booking_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reschedule_service_booking(uuid, uuid, text, text, text) TO authenticated;
