-- Rolls back B3 only. Does not touch commute_publications or commute_circles policies.
-- Executing this re-opens the cross-publication double-book race. Privacy policies stay as they are.

DROP FUNCTION IF EXISTS public.cleaner_city_lock_guest_booking(uuid, date, text);

CREATE OR REPLACE FUNCTION public.cleaner_city_request_ride(
  p_publication_id uuid,
  p_note text DEFAULT NULL,
  p_guest_pickup_lat double precision DEFAULT NULL,
  p_guest_pickup_lng double precision DEFAULT NULL,
  p_guest_dest_lat double precision DEFAULT NULL,
  p_guest_dest_lng double precision DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pub public.commute_publications;
  v_ride public.rides;
  v_fuel integer;
  v_dist double precision;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  IF (
    SELECT count(*) FROM public.rides
    WHERE guest_user_id = v_uid AND created_at > now() - interval '1 hour'
  ) >= 20 THEN
    RAISE EXCEPTION 'Too many ride requests this hour';
  END IF;

  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id FOR UPDATE;
  IF v_pub.id IS NULL THEN RAISE EXCEPTION 'Publication not found'; END IF;
  IF v_pub.status <> 'published' THEN RAISE EXCEPTION 'Publication not open'; END IF;
  IF v_pub.host_user_id = v_uid THEN RAISE EXCEPTION 'Cannot request own ride'; END IF;
  IF v_pub.seats_available < 1 THEN RAISE EXCEPTION 'No seats left'; END IF;
  IF v_pub.origin_latitude IS NULL OR v_pub.destination_latitude IS NULL THEN
    RAISE EXCEPTION 'Publication missing route pins';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.publication_id = p_publication_id
      AND r.guest_user_id = v_uid
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an open request for this ride';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rides r
    JOIN public.commute_publications p ON p.id = r.publication_id
    WHERE r.guest_user_id = v_uid
      AND r.travel_date = v_pub.travel_date
      AND p.direction = v_pub.direction
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an active ride for this date and direction';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.commute_blocks b
    WHERE (b.blocker_user_id = v_uid AND b.blocked_user_id = v_pub.host_user_id)
       OR (b.blocker_user_id = v_pub.host_user_id AND b.blocked_user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Cannot request this host';
  END IF;

  IF p_guest_pickup_lat IS NOT NULL AND p_guest_dest_lat IS NOT NULL THEN
    v_dist := public.cleaner_city_haversine_meters(
      p_guest_pickup_lat, p_guest_pickup_lng, p_guest_dest_lat, p_guest_dest_lng
    );
    v_fuel := public.cleaner_city_estimate_fuel_paise(v_dist, greatest(v_pub.seats_total, 2));
  ELSE
    v_dist := public.cleaner_city_haversine_meters(
      v_pub.origin_latitude, v_pub.origin_longitude,
      v_pub.destination_latitude, v_pub.destination_longitude
    );
    v_fuel := public.cleaner_city_estimate_fuel_paise(v_dist, greatest(v_pub.seats_total, 2));
  END IF;

  UPDATE public.commute_publications
  SET seats_available = seats_available - 1,
      status = CASE WHEN seats_available - 1 <= 0 THEN 'full' ELSE status END,
      updated_at = now()
  WHERE id = p_publication_id;

  INSERT INTO public.rides (
    publication_id, society_id, host_user_id, guest_user_id, travel_date, status,
    guest_pickup_latitude, guest_pickup_longitude, guest_dest_latitude, guest_dest_longitude,
    estimated_fuel_paise, request_expires_at, updated_at
  ) VALUES (
    p_publication_id, v_pub.society_id, v_pub.host_user_id, v_uid, v_pub.travel_date, 'requested',
    p_guest_pickup_lat, p_guest_pickup_lng, p_guest_dest_lat, p_guest_dest_lng,
    v_fuel, now() + interval '3 hours', now()
  )
  RETURNING * INTO v_ride;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'requested', NULL, 'requested',
    jsonb_build_object('note', p_note, 'estimated_fuel_paise', v_fuel)
  );

  PERFORM public.cleaner_city_enqueue_notify(
    v_pub.host_user_id,
    'New seat request',
    'A neighbour requested a seat. Accept or decline soon.',
    'cleaner_city_ride_request',
    v_ride.id,
    v_pub.society_id,
    'cc_req_' || v_ride.id::text
  );

  RETURN v_ride;
END;
$$;
