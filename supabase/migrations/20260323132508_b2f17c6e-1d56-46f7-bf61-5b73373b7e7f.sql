-- Drop BOTH overloads explicitly by their exact signatures
DROP FUNCTION IF EXISTS public.book_service_slot(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.book_service_slot(uuid, uuid, uuid, uuid, uuid, text, text, text, text, text);

-- Create single canonical version with auto-confirm (status = 'confirmed')
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
)
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

  -- 6. Create service booking with auto-confirmed status
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
$function$;