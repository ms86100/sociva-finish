-- Part 2: harder matching + fuel on cards, request enrichment, SOS fan-out,
-- emergency contacts, quick messages, circles, reminders, cron.

-- ---------------------------------------------------------------------------
-- Request ride: store guest pins + deadlines + optional meeting point
-- ---------------------------------------------------------------------------
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

  -- rate limit (reuse existing pattern if present)
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
  IF EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.publication_id = p_publication_id
      AND r.guest_user_id = v_uid
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an open request for this ride';
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
  ELSIF v_pub.origin_latitude IS NOT NULL AND v_pub.destination_latitude IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.cleaner_city_request_ride(uuid, text, double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_request_ride(uuid, text, double precision, double precision, double precision, double precision) TO authenticated;

-- Also keep 2-arg overload for compatibility
CREATE OR REPLACE FUNCTION public.cleaner_city_request_ride(
  p_publication_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.cleaner_city_request_ride(p_publication_id, p_note, NULL, NULL, NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_request_ride(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_request_ride(uuid, text) TO authenticated;

-- Respond: set pickup deadline when accepted
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
  v_deadline timestamptz;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid THEN RAISE EXCEPTION 'Only host can respond'; END IF;
  IF v_ride.status <> 'requested' THEN RAISE EXCEPTION 'Ride is not awaiting response'; END IF;

  SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id;

  IF p_accept THEN
    v_deadline := (v_ride.travel_date + COALESCE(v_pub.depart_time, time '08:30'))
      AT TIME ZONE 'Asia/Kolkata' + interval '30 minutes';
    UPDATE public.rides
    SET status = 'confirmed',
        pickup_deadline_at = v_deadline,
        updated_at = now()
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;
    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'confirmed', 'requested', 'confirmed', '{}'::jsonb
    );
    PERFORM public.cleaner_city_enqueue_notify(
      v_ride.guest_user_id,
      'Seat confirmed',
      'Your commute seat was accepted. Open the ride for pickup details.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_accept_' || v_ride.id::text
    );
  ELSE
    UPDATE public.rides SET status = 'rejected', updated_at = now() WHERE id = p_ride_id
    RETURNING * INTO v_ride;
    UPDATE public.commute_publications p
    SET seats_available = least(p.seats_total, p.seats_available + 1),
        status = CASE WHEN p.status = 'full' THEN 'published' ELSE p.status END,
        updated_at = now()
    WHERE p.id = v_ride.publication_id;
    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'rejected', 'requested', 'rejected', '{}'::jsonb
    );
    PERFORM public.cleaner_city_enqueue_notify(
      v_ride.guest_user_id,
      'Seat request declined',
      'Try another match or join the waitlist.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_reject_' || v_ride.id::text
    );
  END IF;
  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_respond_ride_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_respond_ride_request(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Find matches: hard overlap filter + fuel estimate + circle boost
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_find_matches(
  p_date date,
  p_direction text DEFAULT 'to_office',
  p_depart_time time DEFAULT NULL,
  p_guest_pickup_lat double precision DEFAULT NULL,
  p_guest_pickup_lng double precision DEFAULT NULL,
  p_guest_dest_lat double precision DEFAULT NULL,
  p_guest_dest_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_allowed uuid[];
  v_thresholds jsonb;
  v_pickup_km double precision;
  v_dest_km double precision;
  v_depart_min integer;
  v_max_detour integer;
  v_min_seats integer;
  v_min_overlap integer;
  v_hard_overlap boolean;
  v_depart time;
  v_results jsonb := '[]'::jsonb;
  r record;
  v_host_origin_lat double precision;
  v_host_origin_lng double precision;
  v_host_dest_lat double precision;
  v_host_dest_lng double precision;
  v_pickup_dev_m double precision;
  v_dest_dev_m double precision;
  v_detour jsonb;
  v_detour_min double precision;
  v_score numeric;
  v_reasons text[];
  v_item jsonb;
  v_rep jsonb;
  v_overlap numeric;
  v_fuel integer;
  v_guest_dist double precision;
  v_same_circle boolean;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN RAISE EXCEPTION 'Society membership required'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'date is required'; END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;

  v_allowed := public.cleaner_city_allowed_society_ids(v_uid);
  SELECT s.thresholds INTO v_thresholds
  FROM public.cleaner_city_settings s WHERE s.society_id = v_society;
  v_thresholds := COALESCE(v_thresholds, '{}'::jsonb);
  v_pickup_km := COALESCE((v_thresholds->>'pickup_deviation_km')::double precision, 1.5);
  v_dest_km := COALESCE((v_thresholds->>'destination_deviation_km')::double precision, 2.0);
  v_depart_min := COALESCE((v_thresholds->>'departure_difference_minutes')::integer, 30);
  v_max_detour := COALESCE((v_thresholds->>'max_detour_minutes')::integer, 15);
  v_min_seats := COALESCE((v_thresholds->>'min_seats')::integer, 1);
  v_min_overlap := COALESCE((v_thresholds->>'min_route_overlap_pct')::integer, 65);
  v_hard_overlap := COALESCE((v_thresholds->>'hard_route_overlap')::boolean, true);
  v_depart := p_depart_time;
  IF v_depart IS NULL THEN
    v_depart := ((public.cleaner_city_effective_schedule(v_uid, p_date))->>'depart_time')::time;
  END IF;

  IF p_guest_pickup_lat IS NOT NULL AND p_guest_dest_lat IS NOT NULL THEN
    v_guest_dist := public.cleaner_city_haversine_meters(
      p_guest_pickup_lat, p_guest_pickup_lng, p_guest_dest_lat, p_guest_dest_lng
    );
  END IF;

  FOR r IN
    SELECT
      p.id AS publication_id, p.host_user_id, p.society_id, p.travel_date, p.direction,
      p.depart_time, p.seats_available, p.seats_total, p.vehicle_id, p.route_polyline,
      p.origin_latitude, p.origin_longitude, p.destination_latitude, p.destination_longitude,
      p.origin_label, p.destination_label, v.vehicle_type, v.color AS vehicle_color,
      cp.company_name AS host_company
    FROM public.commute_publications p
    JOIN public.vehicles v ON v.id = p.vehicle_id AND v.is_active = true
    LEFT JOIN public.commute_profiles cp
      ON cp.user_id = p.host_user_id AND cp.deleted_at IS NULL
    WHERE p.status = 'published'
      AND p.travel_date = p_date
      AND p.direction = p_direction
      AND p.seats_available >= v_min_seats
      AND p.host_user_id <> v_uid
      AND p.society_id = ANY (v_allowed)
      AND NOT EXISTS (
        SELECT 1 FROM public.commute_blocks b
        WHERE (b.blocker_user_id = v_uid AND b.blocked_user_id = p.host_user_id)
           OR (b.blocker_user_id = p.host_user_id AND b.blocked_user_id = v_uid)
      )
  LOOP
    v_reasons := ARRAY[]::text[];
    v_score := 0;
    v_pickup_dev_m := NULL;
    v_dest_dev_m := NULL;
    v_detour_min := NULL;
    v_same_circle := false;
    v_fuel := NULL;

    IF v_depart IS NOT NULL THEN
      IF abs(EXTRACT(EPOCH FROM (r.depart_time - v_depart)) / 60.0) > v_depart_min THEN
        CONTINUE;
      END IF;
      v_reasons := array_append(v_reasons, 'departure_within_window');
      v_score := v_score + 20;
    ELSE
      v_reasons := array_append(v_reasons, 'departure_unchecked');
      v_score := v_score + 5;
    END IF;

    v_reasons := array_append(v_reasons, 'seats_available');
    v_score := v_score + least(20, r.seats_available * 5);

    v_host_origin_lat := r.origin_latitude;
    v_host_origin_lng := r.origin_longitude;
    v_host_dest_lat := r.destination_latitude;
    v_host_dest_lng := r.destination_longitude;

    IF p_guest_pickup_lat IS NOT NULL AND p_guest_pickup_lng IS NOT NULL
       AND v_host_origin_lat IS NOT NULL AND v_host_origin_lng IS NOT NULL THEN
      v_pickup_dev_m := public.cleaner_city_haversine_meters(
        p_guest_pickup_lat, p_guest_pickup_lng, v_host_origin_lat, v_host_origin_lng
      );
      IF v_pickup_dev_m > (v_pickup_km * 1000.0) THEN CONTINUE; END IF;
      v_reasons := array_append(v_reasons, 'pickup_within_corridor');
      v_score := v_score + 25;
    ELSE
      v_reasons := array_append(v_reasons, 'pickup_coords_missing');
      v_score := v_score + 8;
    END IF;

    IF p_guest_dest_lat IS NOT NULL AND p_guest_dest_lng IS NOT NULL
       AND v_host_dest_lat IS NOT NULL AND v_host_dest_lng IS NOT NULL THEN
      v_dest_dev_m := public.cleaner_city_haversine_meters(
        p_guest_dest_lat, p_guest_dest_lng, v_host_dest_lat, v_host_dest_lng
      );
      IF v_dest_dev_m <= (v_dest_km * 1000.0) THEN
        v_reasons := array_append(v_reasons, 'destination_near_host_end');
        v_score := v_score + 20;
      ELSE
        v_reasons := array_append(v_reasons, 'destination_along_route_candidate');
        v_score := v_score + 10;
      END IF;
    ELSE
      v_reasons := array_append(v_reasons, 'destination_coords_missing');
      v_score := v_score + 5;
    END IF;

    IF p_guest_pickup_lat IS NOT NULL AND p_guest_dest_lat IS NOT NULL
       AND v_host_origin_lat IS NOT NULL AND v_host_dest_lat IS NOT NULL THEN
      v_detour := public.cleaner_city_estimate_detour_minutes(
        v_host_origin_lat, v_host_origin_lng, v_host_dest_lat, v_host_dest_lng,
        p_guest_pickup_lat, p_guest_pickup_lng, p_guest_dest_lat, p_guest_dest_lng, 25
      );
      IF COALESCE((v_detour->>'ok')::boolean, false) THEN
        v_detour_min := (v_detour->>'estimated_detour_minutes')::double precision;
        IF v_detour_min > v_max_detour THEN CONTINUE; END IF;
        v_reasons := array_append(v_reasons, 'detour_within_limit');
        v_score := v_score + greatest(0, 20 - v_detour_min);
        IF (v_detour->>'direct_meters')::double precision > 0 THEN
          v_overlap := 100.0 * (1.0 - least(1.0,
            (v_detour->>'extra_meters')::double precision /
            NULLIF((v_detour->>'direct_meters')::double precision, 0)
          ));
          IF v_overlap < v_min_overlap THEN
            IF v_hard_overlap THEN
              CONTINUE;
            END IF;
            v_reasons := array_append(v_reasons, 'overlap_soft_below_target');
            v_score := v_score - 5;
          ELSE
            v_reasons := array_append(v_reasons, 'overlap_proxy_ok');
            v_score := v_score + 10;
          END IF;
        END IF;
      END IF;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.commute_circle_members a
      JOIN public.commute_circle_members b ON a.circle_id = b.circle_id
      JOIN public.commute_circles c ON c.id = a.circle_id AND c.is_active
      WHERE a.user_id = v_uid AND b.user_id = r.host_user_id
    ) INTO v_same_circle;
    IF v_same_circle THEN
      v_reasons := array_append(v_reasons, 'shared_circle');
      v_score := v_score + 30;
    END IF;

    v_fuel := public.cleaner_city_estimate_fuel_paise(
      COALESCE(v_guest_dist,
        CASE WHEN v_host_origin_lat IS NOT NULL AND v_host_dest_lat IS NOT NULL THEN
          public.cleaner_city_haversine_meters(
            v_host_origin_lat, v_host_origin_lng, v_host_dest_lat, v_host_dest_lng
          )
        ELSE NULL END
      ),
      greatest(r.seats_total, 2)
    );

    SELECT public.cleaner_city_reputation(r.host_user_id) INTO v_rep;

    v_item := jsonb_build_object(
      'publication_id', r.publication_id,
      'host_user_id', r.host_user_id,
      'society_id', r.society_id,
      'travel_date', r.travel_date,
      'direction', r.direction,
      'depart_time', r.depart_time,
      'seats_available', r.seats_available,
      'seats_total', r.seats_total,
      'vehicle_type', r.vehicle_type,
      'vehicle_color', r.vehicle_color,
      'host_company', r.host_company,
      'origin_label', COALESCE(r.origin_label, 'Pickup corridor'),
      'destination_label', COALESCE(r.destination_label, 'Drop corridor'),
      'has_route', r.route_polyline IS NOT NULL,
      'estimated_detour_minutes', v_detour_min,
      'pickup_deviation_meters', v_pickup_dev_m,
      'destination_deviation_meters', v_dest_dev_m,
      'host_avg_stars', v_rep->>'avg_stars',
      'host_rating_count', v_rep->>'rating_count',
      'estimated_fuel_paise', v_fuel,
      'shared_circle', v_same_circle,
      'score', round(v_score, 1),
      'reasons', to_jsonb(v_reasons)
    );
    v_results := v_results || jsonb_build_array(v_item);
  END LOOP;

  RETURN jsonb_build_object(
    'date', p_date,
    'direction', p_direction,
    'match_scope_societies', to_jsonb(v_allowed),
    'thresholds', jsonb_build_object(
      'pickup_deviation_km', v_pickup_km,
      'destination_deviation_km', v_dest_km,
      'departure_difference_minutes', v_depart_min,
      'max_detour_minutes', v_max_detour,
      'min_seats', v_min_seats,
      'min_route_overlap_pct', v_min_overlap,
      'hard_route_overlap', v_hard_overlap
    ),
    'matches', (
      SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'score')::numeric DESC), '[]'::jsonb)
      FROM jsonb_array_elements(v_results) elem
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Meeting point
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_set_meeting_point(
  p_ride_id uuid,
  p_label text,
  p_latitude double precision,
  p_longitude double precision
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending', 'started') THEN
    RAISE EXCEPTION 'Meeting point only after confirm';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Coordinates required';
  END IF;

  UPDATE public.rides
  SET meeting_point_label = NULLIF(trim(COALESCE(p_label, '')), ''),
      meeting_point_latitude = p_latitude,
      meeting_point_longitude = p_longitude,
      updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'meeting_point_set',
    v_ride.status, v_ride.status,
    jsonb_build_object('label', v_ride.meeting_point_label)
  );
  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_meeting_point(uuid, text, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_meeting_point(uuid, text, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_list_meetup_points()
RETURNS SETOF public.society_meetup_points
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_society uuid := public.get_user_society_id(auth.uid());
BEGIN
  RETURN QUERY
  SELECT m.*
  FROM public.society_meetup_points m
  WHERE m.is_active
    AND m.society_id = ANY (public.cleaner_city_allowed_society_ids(auth.uid()))
  ORDER BY m.sort_order, m.label;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_list_meetup_points() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_list_meetup_points() TO authenticated;

-- ---------------------------------------------------------------------------
-- Emergency contacts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_upsert_emergency_contact(
  p_contact_name text,
  p_phone text DEFAULT NULL,
  p_notify_user_id uuid DEFAULT NULL,
  p_is_primary boolean DEFAULT false,
  p_contact_id uuid DEFAULT NULL
)
RETURNS public.commute_emergency_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.commute_emergency_contacts;
  v_count integer;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  IF char_length(trim(COALESCE(p_contact_name, ''))) < 1 THEN
    RAISE EXCEPTION 'Contact name required';
  END IF;

  SELECT count(*) INTO v_count FROM public.commute_emergency_contacts WHERE user_id = v_uid;
  IF p_contact_id IS NULL AND v_count >= 3 THEN
    RAISE EXCEPTION 'Maximum 3 emergency contacts';
  END IF;

  IF p_is_primary THEN
    UPDATE public.commute_emergency_contacts SET is_primary = false WHERE user_id = v_uid;
  END IF;

  IF p_contact_id IS NULL THEN
    INSERT INTO public.commute_emergency_contacts (
      user_id, society_id, contact_name, phone, notify_user_id, is_primary, updated_at
    ) VALUES (
      v_uid, v_society, trim(p_contact_name), NULLIF(trim(COALESCE(p_phone, '')), ''),
      p_notify_user_id, COALESCE(p_is_primary, false), now()
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.commute_emergency_contacts
    SET contact_name = trim(p_contact_name),
        phone = NULLIF(trim(COALESCE(p_phone, '')), ''),
        notify_user_id = p_notify_user_id,
        is_primary = COALESCE(p_is_primary, is_primary),
        updated_at = now()
    WHERE id = p_contact_id AND user_id = v_uid
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'Contact not found'; END IF;
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_upsert_emergency_contact(text, text, uuid, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_upsert_emergency_contact(text, text, uuid, boolean, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_delete_emergency_contact(p_contact_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.commute_emergency_contacts
  WHERE id = p_contact_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_delete_emergency_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_delete_emergency_contact(uuid) TO authenticated;

-- SOS: fan-out to emergency contacts (in-app notify_user_id) + counterpart + keep admin queue
CREATE OR REPLACE FUNCTION public.cleaner_city_report_incident(
  p_ride_id uuid,
  p_incident_type text,
  p_note text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_severity text DEFAULT 'high'
)
RETURNS public.ride_incidents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_row public.ride_incidents;
  v_other uuid;
  c record;
  v_share public.ride_share_tokens;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF p_incident_type IS NULL OR p_incident_type NOT IN (
    'sos', 'unsafe_driving', 'harassment', 'accident', 'no_show', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid incident_type';
  END IF;

  INSERT INTO public.ride_incidents (
    ride_id, society_id, reporter_user_id, incident_type, severity, note,
    latitude, longitude, status, updated_at
  )
  VALUES (
    p_ride_id, v_ride.society_id, v_uid, p_incident_type,
    COALESCE(NULLIF(p_severity, ''), 'high'),
    NULLIF(trim(COALESCE(p_note, '')), ''),
    p_latitude, p_longitude, 'open', now()
  )
  RETURNING * INTO v_row;

  IF p_incident_type = 'sos' THEN
    UPDATE public.rides
    SET status = 'safety_incident', updated_at = now()
    WHERE id = p_ride_id
      AND status IN ('requested', 'confirmed', 'pickup_pending', 'started');
  END IF;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'incident_' || p_incident_type,
    v_ride.status, CASE WHEN p_incident_type = 'sos' THEN 'safety_incident' ELSE v_ride.status END,
    jsonb_build_object('incident_id', v_row.id, 'severity', v_row.severity)
  );

  v_other := CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END;

  PERFORM public.cleaner_city_enqueue_notify(
    v_other,
    CASE WHEN p_incident_type = 'sos' THEN 'SOS on your commute' ELSE 'Safety report on ride' END,
    'A participant reported a safety issue. Open the ride for details.',
    'cleaner_city_safety',
    p_ride_id,
    v_ride.society_id,
    'cc_safety_' || v_row.id::text
  );

  IF p_incident_type = 'sos' THEN
    -- Ensure a share token exists for contacts
    BEGIN
      SELECT * INTO v_share FROM public.cleaner_city_create_share_token(p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      v_share := NULL;
    END;

    FOR c IN
      SELECT * FROM public.commute_emergency_contacts
      WHERE user_id = v_uid AND notify_user_id IS NOT NULL
    LOOP
      PERFORM public.cleaner_city_enqueue_notify(
        c.notify_user_id,
        'Emergency: Cleaner City SOS',
        'Your contact triggered SOS on a commute. Open the shared ride link in Sociva.',
        'cleaner_city_safety',
        p_ride_id,
        v_ride.society_id,
        'cc_sos_ec_' || v_row.id::text || '_' || c.id::text
      );
    END LOOP;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_report_incident(
  uuid, text, text, double precision, double precision, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_report_incident(
  uuid, text, text, double precision, double precision, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Quick messages
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_send_quick_message(
  p_ride_id uuid,
  p_phrase_key text
)
RETURNS public.ride_quick_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_row public.ride_quick_messages;
  v_other uuid;
  v_body text;
  v_recent integer;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending', 'started') THEN
    RAISE EXCEPTION 'Messages only on active rides';
  END IF;
  IF p_phrase_key NOT IN ('here', 'five_late', 'wrong_gate', 'coming', 'wait') THEN
    RAISE EXCEPTION 'Invalid phrase';
  END IF;

  SELECT count(*) INTO v_recent
  FROM public.ride_quick_messages
  WHERE ride_id = p_ride_id AND sender_user_id = v_uid AND created_at > now() - interval '2 minutes';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'Slow down - too many messages';
  END IF;

  INSERT INTO public.ride_quick_messages (ride_id, society_id, sender_user_id, phrase_key)
  VALUES (p_ride_id, v_ride.society_id, v_uid, p_phrase_key)
  RETURNING * INTO v_row;

  v_body := CASE p_phrase_key
    WHEN 'here' THEN 'I am here at the pickup point'
    WHEN 'five_late' THEN 'Running about 5 minutes late'
    WHEN 'wrong_gate' THEN 'Wrong gate - please check meeting point'
    WHEN 'coming' THEN 'On my way'
    WHEN 'wait' THEN 'Please wait a moment'
    ELSE p_phrase_key
  END;

  v_other := CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END;
  PERFORM public.cleaner_city_enqueue_notify(
    v_other,
    'Pickup update',
    v_body,
    'cleaner_city_ride_update',
    p_ride_id,
    v_ride.society_id,
    'cc_qm_' || v_row.id::text
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_send_quick_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_send_quick_message(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Circles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_create_circle(
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS public.commute_circles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.commute_circles;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  INSERT INTO public.commute_circles (society_id, name, description, created_by)
  VALUES (v_society, trim(p_name), NULLIF(trim(COALESCE(p_description, '')), ''), v_uid)
  RETURNING * INTO v_row;
  INSERT INTO public.commute_circle_members (circle_id, user_id, role)
  VALUES (v_row.id, v_uid, 'owner');
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_create_circle(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_create_circle(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_join_circle(p_invite_code text)
RETURNS public.commute_circle_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_circle public.commute_circles;
  v_row public.commute_circle_members;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_circle FROM public.commute_circles
  WHERE invite_code = lower(trim(p_invite_code)) AND is_active;
  IF v_circle.id IS NULL THEN
    -- try exact
    SELECT * INTO v_circle FROM public.commute_circles
    WHERE invite_code = trim(p_invite_code) AND is_active;
  END IF;
  IF v_circle.id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  INSERT INTO public.commute_circle_members (circle_id, user_id, role)
  VALUES (v_circle.id, v_uid, 'member')
  ON CONFLICT (circle_id, user_id) DO UPDATE SET role = public.commute_circle_members.role
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_join_circle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_join_circle(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_my_circles()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'description', c.description,
      'invite_code', c.invite_code,
      'role', m.role,
      'member_count', (SELECT count(*) FROM public.commute_circle_members x WHERE x.circle_id = c.id)
    ) ORDER BY c.name)
    FROM public.commute_circle_members m
    JOIN public.commute_circles c ON c.id = m.circle_id AND c.is_active
    WHERE m.user_id = auth.uid()
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_my_circles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_my_circles() TO authenticated;

-- ---------------------------------------------------------------------------
-- Evening / morning reminder sweep (service role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_send_commute_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tomorrow date := (timezone('Asia/Kolkata', now()))::date + 1;
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_hour integer := EXTRACT(HOUR FROM timezone('Asia/Kolkata', now()))::integer;
  v_evening integer := 0;
  v_morning integer := 0;
  r record;
  v_sched jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Evening 19-21: remind hosts without publication for tomorrow
  IF v_hour BETWEEN 19 AND 21 THEN
    FOR r IN
      SELECT cp.* FROM public.commute_profiles cp
      WHERE cp.deleted_at IS NULL AND cp.is_paused = false
        AND cp.role IN ('host', 'both')
    LOOP
      v_sched := public.cleaner_city_effective_schedule(r.user_id, v_tomorrow);
      IF COALESCE((v_sched->>'is_working')::boolean, false)
         AND NOT EXISTS (
           SELECT 1 FROM public.commute_publications p
           WHERE p.host_user_id = r.user_id AND p.travel_date = v_tomorrow
             AND p.status IN ('draft', 'published', 'full')
         ) THEN
        PERFORM public.cleaner_city_enqueue_notify(
          r.user_id,
          'Publish tomorrow commute?',
          'Your schedule says you are commuting tomorrow. Offer seats or enable Autopilot.',
          'cleaner_city_ride_update',
          NULL,
          r.society_id,
          'cc_remind_pub_' || r.user_id::text || '_' || v_tomorrow::text
        );
        v_evening := v_evening + 1;
      END IF;
    END LOOP;
  END IF;

  -- Morning 6-8: remind confirmed rides
  IF v_hour BETWEEN 6 AND 8 THEN
    FOR r IN
      SELECT * FROM public.rides
      WHERE travel_date = v_today
        AND status IN ('confirmed', 'pickup_pending')
    LOOP
      PERFORM public.cleaner_city_enqueue_notify(
        r.host_user_id,
        'Commute today',
        'You have a Cleaner City ride today. Open for OTP and pickup.',
        'cleaner_city_ride_update',
        r.id,
        r.society_id,
        'cc_remind_am_h_' || r.id::text
      );
      PERFORM public.cleaner_city_enqueue_notify(
        r.guest_user_id,
        'Commute today',
        'Your seat is confirmed for today. Open for meeting point and OTP.',
        'cleaner_city_ride_update',
        r.id,
        r.society_id,
        'cc_remind_am_g_' || r.id::text
      );
      v_morning := v_morning + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('evening_prompts', v_evening, 'morning_ride_nudges', v_morning);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_send_commute_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_send_commute_reminders() TO service_role;

-- Wire confirm_publication to notify waitlist
CREATE OR REPLACE FUNCTION public.cleaner_city_confirm_publication(
  p_publication_id uuid,
  p_confirm boolean DEFAULT true
)
RETURNS public.commute_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_publications;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_row FROM public.commute_publications WHERE id = p_publication_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Publication not found';
  END IF;
  IF p_confirm THEN
    IF v_row.status <> 'draft' THEN
      RAISE EXCEPTION 'Only drafts can be confirmed';
    END IF;
    IF v_row.origin_latitude IS NULL OR v_row.destination_latitude IS NULL THEN
      RAISE EXCEPTION 'Set pickup and office pins before confirming';
    END IF;
    UPDATE public.commute_publications
    SET status = 'published', updated_at = now()
    WHERE id = p_publication_id
    RETURNING * INTO v_row;
    PERFORM public.cleaner_city_notify_waitlist_for_publication(v_row.id);
  ELSE
    UPDATE public.commute_publications
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_publication_id
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cron (optional if pg_cron present)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('cleaner-city-autopilot');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('cleaner-city-timeouts');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('cleaner-city-reminders');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule(
      'cleaner-city-autopilot',
      '15 20 * * *',
      $cron$ SELECT public.cleaner_city_autopilot_run(((timezone('Asia/Kolkata', now()))::date + 1)); $cron$
    );
    PERFORM cron.schedule(
      'cleaner-city-timeouts',
      '*/15 * * * *',
      $cron$ SELECT public.cleaner_city_process_timeouts(); $cron$
    );
    PERFORM cron.schedule(
      'cleaner-city-reminders',
      '10 * * * *',
      $cron$ SELECT public.cleaner_city_send_commute_reminders(); $cron$
    );
  END IF;
END;
$$;

-- Default hard overlap in settings JSON for societies that have settings
UPDATE public.cleaner_city_settings
SET thresholds = COALESCE(thresholds, '{}'::jsonb) || jsonb_build_object('hard_route_overlap', true),
    updated_at = now()
WHERE thresholds IS NULL OR NOT (thresholds ? 'hard_route_overlap');
