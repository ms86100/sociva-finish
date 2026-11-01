-- Reliable lookup for the guest's open ride (bypasses list lag / fragile client filters).
CREATE OR REPLACE FUNCTION public.cleaner_city_my_active_guest_ride(
  p_travel_date date DEFAULT NULL,
  p_direction text DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_travel_date IS NOT NULL AND p_direction IS NOT NULL THEN
    SELECT r.*
    INTO v_ride
    FROM public.rides r
    JOIN public.commute_publications p ON p.id = r.publication_id
    WHERE r.guest_user_id = v_uid
      AND r.travel_date = p_travel_date
      AND p.direction = p_direction
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident')
    ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
    LIMIT 1;
    IF v_ride.id IS NOT NULL THEN
      RETURN v_ride;
    END IF;
  END IF;

  IF p_travel_date IS NOT NULL THEN
    SELECT r.*
    INTO v_ride
    FROM public.rides r
    WHERE r.guest_user_id = v_uid
      AND r.travel_date = p_travel_date
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident')
    ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
    LIMIT 1;
    IF v_ride.id IS NOT NULL THEN
      RETURN v_ride;
    END IF;
  END IF;

  SELECT r.*
  INTO v_ride
  FROM public.rides r
  WHERE r.guest_user_id = v_uid
    AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident')
  ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
  LIMIT 1;

  RETURN v_ride;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleaner_city_my_active_guest_ride(date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_my_active_guest_ride(date, text) TO authenticated;
