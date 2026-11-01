-- A Cleaner City Unit 7: request / accept / cancel with seat holds.
-- Seat capacity is enforced server-side; clients never decrement seats locally.

CREATE OR REPLACE FUNCTION public.cleaner_city_append_ride_event(
  p_ride_id uuid,
  p_society_id uuid,
  p_actor_id uuid,
  p_event_type text,
  p_from_status text DEFAULT NULL,
  p_to_status text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.ride_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ride_events;
BEGIN
  INSERT INTO public.ride_events (
    ride_id, society_id, actor_id, event_type, from_status, to_status, metadata
  )
  VALUES (
    p_ride_id, p_society_id, p_actor_id, p_event_type,
    p_from_status, p_to_status, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_append_ride_event(
  uuid, uuid, uuid, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_append_ride_event(
  uuid, uuid, uuid, text, text, text, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_request_ride(
  p_publication_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pub public.commute_publications;
  v_row public.rides;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_pub
  FROM public.commute_publications
  WHERE id = p_publication_id
  FOR UPDATE;

  IF v_pub.id IS NULL THEN
    RAISE EXCEPTION 'Publication not found';
  END IF;
  IF v_pub.status <> 'published' THEN
    RAISE EXCEPTION 'Ride is not open for requests';
  END IF;
  IF v_pub.host_user_id = v_uid THEN
    RAISE EXCEPTION 'Cannot request your own ride';
  END IF;
  IF v_pub.seats_available < 1 THEN
    RAISE EXCEPTION 'No seats available';
  END IF;
  IF NOT (v_pub.society_id = ANY (public.cleaner_city_allowed_society_ids(v_uid))) THEN
    RAISE EXCEPTION 'Publication outside your match scope';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.publication_id = p_publication_id
      AND r.guest_user_id = v_uid
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an open request for this ride';
  END IF;

  UPDATE public.commute_publications
  SET
    seats_available = seats_available - 1,
    status = CASE WHEN seats_available - 1 <= 0 THEN 'full' ELSE status END,
    updated_at = now()
  WHERE id = p_publication_id;

  INSERT INTO public.rides (
    society_id, publication_id, host_user_id, guest_user_id, travel_date, status, updated_at
  )
  VALUES (
    v_pub.society_id, v_pub.id, v_pub.host_user_id, v_uid, v_pub.travel_date, 'requested', now()
  )
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_append_ride_event(
    v_row.id, v_row.society_id, v_uid, 'requested',
    NULL, 'requested',
    jsonb_build_object('publication_id', p_publication_id, 'note', NULLIF(trim(COALESCE(p_note, '')), ''))
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_request_ride(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_request_ride(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_respond_ride_request(
  p_ride_id uuid,
  p_accept boolean
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_pub public.commute_publications;
  v_from text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Only the host can respond';
  END IF;
  IF v_ride.status <> 'requested' THEN
    RAISE EXCEPTION 'Ride is not awaiting a response';
  END IF;

  v_from := v_ride.status;

  IF COALESCE(p_accept, false) THEN
    UPDATE public.rides
    SET status = 'confirmed', updated_at = now()
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;

    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'confirmed', v_from, 'confirmed', '{}'::jsonb
    );
  ELSE
    UPDATE public.rides
    SET status = 'rejected', updated_at = now()
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;

    SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id FOR UPDATE;
    IF v_pub.id IS NOT NULL AND v_pub.status IN ('published', 'full') THEN
      UPDATE public.commute_publications
      SET
        seats_available = least(seats_total, seats_available + 1),
        status = 'published',
        updated_at = now()
      WHERE id = v_pub.id;
    END IF;

    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'rejected', v_from, 'rejected', '{}'::jsonb
    );
  END IF;

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_respond_ride_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_respond_ride_request(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_cancel_ride(
  p_ride_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_pub public.commute_publications;
  v_from text;
  v_other uuid;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('requested', 'confirmed', 'pickup_pending') THEN
    RAISE EXCEPTION 'Ride cannot be cancelled in status %', v_ride.status;
  END IF;

  v_from := v_ride.status;
  v_other := CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END;

  UPDATE public.rides
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  IF v_ride.publication_id IS NOT NULL THEN
    SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id FOR UPDATE;
    IF v_pub.id IS NOT NULL AND v_pub.status IN ('published', 'full') THEN
      UPDATE public.commute_publications
      SET
        seats_available = least(seats_total, seats_available + 1),
        status = 'published',
        updated_at = now()
      WHERE id = v_pub.id;
    END IF;
  END IF;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'cancelled', v_from, 'cancelled',
    jsonb_build_object('reason', NULLIF(trim(COALESCE(p_reason, '')), ''))
  );

  -- Notify counterpart when Unit 11 enqueue helper exists (no-op safe if missing at Unit 7 apply time)
  BEGIN
    PERFORM public.cleaner_city_enqueue_notify(
      v_other,
      'Ride cancelled',
      'Your commute ride was cancelled.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_cancel_' || v_ride.id::text || '_' || extract(epoch from now())::bigint::text
    );
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_cancel_ride(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_cancel_ride(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_request_ride IS
  'Unit 7: guest request with atomic seat hold.';
COMMENT ON FUNCTION public.cleaner_city_respond_ride_request IS
  'Unit 7: host accept/reject; reject releases seat.';
COMMENT ON FUNCTION public.cleaner_city_cancel_ride IS
  'Unit 7/11: cancel with seat release, audit event, and counterpart notify.';
