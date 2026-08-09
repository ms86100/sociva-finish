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