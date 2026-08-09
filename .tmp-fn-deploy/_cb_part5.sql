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