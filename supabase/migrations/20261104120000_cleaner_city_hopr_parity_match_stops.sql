-- Hopr/QuickRide parity: enrich corridor match payload + insert mid-route stop on accept.

CREATE OR REPLACE FUNCTION public.cleaner_city_match_reason_label(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_code
    WHEN 'departure_within_window' THEN 'Leaves near your time'
    WHEN 'departure_unchecked' THEN 'Time flexible'
    WHEN 'seats_available' THEN 'Seats open'
    WHEN 'pickup_on_route_corridor' THEN 'Pickup on route'
    WHEN 'drop_on_route_corridor' THEN 'Drop on route'
    WHEN 'drop_mid_route' THEN 'Drop mid-route'
    WHEN 'pickup_before_drop' THEN 'Stops in order'
    WHEN 'destination_near_host_end' THEN 'Drops near you'
    WHEN 'detour_within_limit' THEN 'Small detour'
    WHEN 'road_polyline_overlap' THEN 'Fits their route'
    WHEN 'road_overlap_below_target' THEN 'Weak route fit'
    WHEN 'shared_circle' THEN 'Trusted circle'
    WHEN 'drop_near_extra_stop' THEN 'Near an extra stop'
    WHEN 'circle_with_two_completed_rides' THEN 'Circle + history'
    WHEN 'vehicle_documents_verified' THEN 'Docs verified'
    ELSE replace(coalesce(p_code, ''), '_', ' ')
  END;
$$;

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
  v_labels text[] := ARRAY[]::text[];
  v_code text;
  v_item jsonb;
  v_rep jsonb;
  v_fuel integer;
  v_guest_dist double precision;
  v_same_circle boolean;
  v_circle_only boolean := false;
  v_road_overlap numeric;
  v_no_shows integer := 0;
  v_open_city boolean := false;
  v_require_history boolean := false;
  v_stop_m double precision;
  v_host_completed integer := 0;
  v_vehicle_verified boolean := false;
  v_pick jsonb;
  v_drop jsonb;
  v_pick_idx integer;
  v_drop_idx integer;
  v_on_route_drop boolean := false;
  v_host_end_m double precision;
  v_poly_len integer;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN RAISE EXCEPTION 'Society membership required'; END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'date is required'; END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;
  IF p_guest_pickup_lat IS NULL OR p_guest_pickup_lng IS NULL
     OR p_guest_dest_lat IS NULL OR p_guest_dest_lng IS NULL THEN
    RAISE EXCEPTION 'Pickup and destination pins are required';
  END IF;
  SELECT COALESCE(circle_only_matching, false),
         COALESCE(require_circle_history, false),
         COALESCE(open_city_matching, false)
    INTO v_circle_only, v_require_history, v_open_city
  FROM public.commute_profiles
  WHERE user_id = v_uid AND deleted_at IS NULL;

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

  v_guest_dist := public.cleaner_city_haversine_meters(
    p_guest_pickup_lat, p_guest_pickup_lng, p_guest_dest_lat, p_guest_dest_lng
  );

  FOR r IN
    SELECT
      p.id AS publication_id, p.host_user_id, p.society_id, p.travel_date, p.direction,
      p.depart_time, p.seats_available, p.seats_total, p.vehicle_id, p.route_polyline,
      p.origin_latitude, p.origin_longitude, p.destination_latitude, p.destination_longitude,
      p.origin_label, p.destination_label, p.route_distance_meters,
      v.vehicle_type, v.color AS vehicle_color,
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
      AND p.route_polyline IS NOT NULL
      AND length(trim(p.route_polyline)) >= 10
      AND (
        p.society_id = ANY (v_allowed)
        OR (
          COALESCE(v_open_city, false)
          AND COALESCE(cp.open_city_matching, false)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.commute_blocks b
        WHERE (b.blocker_user_id = v_uid AND b.blocked_user_id = p.host_user_id)
           OR (b.blocker_user_id = p.host_user_id AND b.blocked_user_id = v_uid)
      )
  LOOP
    v_reasons := ARRAY[]::text[];
    v_labels := ARRAY[]::text[];
    v_score := 0;
    v_pickup_dev_m := NULL;
    v_dest_dev_m := NULL;
    v_detour_min := NULL;
    v_same_circle := false;
    v_fuel := NULL;
    v_road_overlap := NULL;
    v_pick := NULL;
    v_drop := NULL;
    v_stop_m := NULL;
    v_on_route_drop := false;
    v_host_end_m := NULL;

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

    v_pick := public.cleaner_city_project_point_on_polyline(
      r.route_polyline, p_guest_pickup_lat, p_guest_pickup_lng, 250
    );
    v_drop := public.cleaner_city_project_point_on_polyline(
      r.route_polyline, p_guest_dest_lat, p_guest_dest_lng, 250
    );
    IF v_pick IS NULL OR v_drop IS NULL THEN
      CONTINUE;
    END IF;

    v_pickup_dev_m := (v_pick->>'distance_m')::double precision;
    v_dest_dev_m := (v_drop->>'distance_m')::double precision;
    v_pick_idx := (v_pick->>'index')::integer;
    v_drop_idx := (v_drop->>'index')::integer;

    IF v_pickup_dev_m > (v_pickup_km * 1000.0) THEN
      CONTINUE;
    END IF;
    IF v_dest_dev_m > (v_dest_km * 1000.0) THEN
      CONTINUE;
    END IF;
    IF v_pick_idx IS NULL OR v_drop_idx IS NULL OR v_pick_idx >= v_drop_idx THEN
      CONTINUE;
    END IF;

    v_reasons := array_append(v_reasons, 'pickup_on_route_corridor');
    v_score := v_score + 25;
    v_reasons := array_append(v_reasons, 'drop_on_route_corridor');
    v_score := v_score + 20;
    v_reasons := array_append(v_reasons, 'pickup_before_drop');
    v_score := v_score + 15;

    -- Mid-route drop: on corridor and meaningfully before host final destination.
    IF v_host_dest_lat IS NOT NULL AND v_host_dest_lng IS NOT NULL THEN
      v_host_end_m := public.cleaner_city_haversine_meters(
        p_guest_dest_lat, p_guest_dest_lng, v_host_dest_lat, v_host_dest_lng
      );
    END IF;
    v_poly_len := greatest(COALESCE((v_drop->>'points_scanned')::integer, v_drop_idx + 1), 2);
    IF COALESCE(v_host_end_m, 99999) > 400
       AND v_drop_idx < (v_poly_len - 1) THEN
      v_on_route_drop := true;
      v_reasons := array_append(v_reasons, 'drop_mid_route');
      v_score := v_score + 12;
    END IF;

    v_road_overlap := public.cleaner_city_polyline_overlap_pct(
      r.route_polyline,
      p_guest_pickup_lat, p_guest_pickup_lng,
      p_guest_dest_lat, p_guest_dest_lng
    );
    IF v_road_overlap IS NOT NULL THEN
      IF v_road_overlap < v_min_overlap THEN
        IF v_hard_overlap THEN CONTINUE; END IF;
        v_reasons := array_append(v_reasons, 'road_overlap_below_target');
        v_score := v_score - 5;
      ELSE
        v_reasons := array_append(v_reasons, 'road_polyline_overlap');
        v_score := v_score + 15;
      END IF;
    ELSIF v_hard_overlap THEN
      CONTINUE;
    END IF;

    IF v_host_dest_lat IS NOT NULL AND v_host_dest_lng IS NOT NULL THEN
      IF COALESCE(v_host_end_m, 99999) <= (v_dest_km * 1000.0) THEN
        v_reasons := array_append(v_reasons, 'destination_near_host_end');
        v_score := v_score + 8;
      END IF;
    END IF;

    SELECT min(public.cleaner_city_haversine_meters(
      p_guest_dest_lat, p_guest_dest_lng, s.latitude, s.longitude
    )) INTO v_stop_m
    FROM public.commute_publication_stops s
    WHERE s.publication_id = r.publication_id;
    IF v_stop_m IS NOT NULL AND v_stop_m <= (v_dest_km * 1000.0) THEN
      v_reasons := array_append(v_reasons, 'drop_near_extra_stop');
      v_score := v_score + 8;
    END IF;

    IF v_host_origin_lat IS NOT NULL AND v_host_dest_lat IS NOT NULL THEN
      v_detour := public.cleaner_city_estimate_detour_minutes(
        v_host_origin_lat, v_host_origin_lng, v_host_dest_lat, v_host_dest_lng,
        p_guest_pickup_lat, p_guest_pickup_lng, p_guest_dest_lat, p_guest_dest_lng, 25
      );
      IF COALESCE((v_detour->>'ok')::boolean, false) THEN
        v_detour_min := (v_detour->>'estimated_detour_minutes')::double precision;
        IF v_detour_min > v_max_detour THEN CONTINUE; END IF;
        v_reasons := array_append(v_reasons, 'detour_within_limit');
        v_score := v_score + greatest(0, 20 - v_detour_min);
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
    ELSIF COALESCE(v_circle_only, false) OR COALESCE(v_require_history, false) THEN
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_host_completed
    FROM public.rides hc
    WHERE hc.host_user_id = r.host_user_id AND hc.status = 'completed';
    IF COALESCE(v_require_history, false) THEN
      IF NOT COALESCE(v_same_circle, false) OR COALESCE(v_host_completed, 0) < 2 THEN
        CONTINUE;
      END IF;
      v_reasons := array_append(v_reasons, 'circle_with_two_completed_rides');
      v_score := v_score + 10;
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.vehicle_documents d
      WHERE d.vehicle_id = r.vehicle_id AND d.status = 'verified'
    ) INTO v_vehicle_verified;
    IF v_vehicle_verified THEN
      v_reasons := array_append(v_reasons, 'vehicle_documents_verified');
      v_score := v_score + 5;
    END IF;
    SELECT count(*) INTO v_no_shows
    FROM public.rides ns
    WHERE ns.host_user_id = r.host_user_id AND ns.status = 'no_show';

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

    FOREACH v_code IN ARRAY v_reasons LOOP
      v_labels := array_append(v_labels, public.cleaner_city_match_reason_label(v_code));
    END LOOP;

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
      'has_route', true,
      'estimated_detour_minutes', v_detour_min,
      'pickup_deviation_meters', v_pickup_dev_m,
      'destination_deviation_meters', v_dest_dev_m,
      'pickup_route_index', v_pick_idx,
      'drop_route_index', v_drop_idx,
      'on_route_drop', v_on_route_drop,
      'host_avg_stars', v_rep->>'avg_stars',
      'host_rating_count', v_rep->>'rating_count',
      'estimated_fuel_paise', v_fuel,
      'shared_circle', v_same_circle,
      'pickup_walk_meters', v_pickup_dev_m,
      'host_no_show_count', v_no_shows,
      'road_overlap_pct', v_road_overlap,
      'host_completed_rides', v_host_completed,
      'host_vehicle_verified', v_vehicle_verified,
      'extra_stop_meters', v_stop_m,
      'route_distance_meters', r.route_distance_meters,
      'score', round(v_score, 1),
      'reasons', to_jsonb(v_reasons),
      'reason_labels', to_jsonb(v_labels)
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
    'matches', COALESCE((
      SELECT jsonb_agg(elem ORDER BY (elem->>'score')::numeric DESC)
      FROM jsonb_array_elements(v_results) elem
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_find_matches(date, text, time, double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_find_matches(date, text, time, double precision, double precision, double precision, double precision) TO authenticated;

-- On accept: insert ordered guest drop stop when destination projects mid-route.
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
  v_drop jsonb;
  v_drop_idx integer;
  v_host_end_m double precision;
  v_seq integer;
  v_label text;
  v_order jsonb;
  v_stop_id uuid;
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

    -- C-on-path: persist guest drop as an ordered publication stop when mid-route.
    IF v_pub.id IS NOT NULL
       AND v_pub.route_polyline IS NOT NULL
       AND length(trim(v_pub.route_polyline)) >= 10
       AND v_ride.guest_dest_latitude IS NOT NULL
       AND v_ride.guest_dest_longitude IS NOT NULL THEN
      v_drop := public.cleaner_city_project_point_on_polyline(
        v_pub.route_polyline,
        v_ride.guest_dest_latitude,
        v_ride.guest_dest_longitude,
        250
      );
      IF v_drop IS NOT NULL THEN
        v_drop_idx := (v_drop->>'index')::integer;
        IF v_pub.destination_latitude IS NOT NULL AND v_pub.destination_longitude IS NOT NULL THEN
          v_host_end_m := public.cleaner_city_haversine_meters(
            v_ride.guest_dest_latitude, v_ride.guest_dest_longitude,
            v_pub.destination_latitude, v_pub.destination_longitude
          );
        END IF;
        IF COALESCE(v_host_end_m, 99999) > 400 THEN
          SELECT COALESCE(max(s.seq), 0) + 1 INTO v_seq
          FROM public.commute_publication_stops s
          WHERE s.publication_id = v_pub.id;
          IF v_seq IS NULL OR v_seq < 1 THEN v_seq := 1; END IF;
          IF v_seq > 5 THEN v_seq := 5; END IF;
          v_label := 'Guest drop';
          INSERT INTO public.commute_publication_stops (
            publication_id, society_id, seq, label, latitude, longitude
          ) VALUES (
            v_pub.id, v_pub.society_id, v_seq, v_label,
            v_ride.guest_dest_latitude, v_ride.guest_dest_longitude
          )
          ON CONFLICT (publication_id, seq) DO UPDATE
          SET label = EXCLUDED.label,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude
          RETURNING id INTO v_stop_id;

          v_order := COALESCE(v_pub.drop_order_json, '[]'::jsonb);
          IF jsonb_typeof(v_order) <> 'array' THEN
            v_order := '[]'::jsonb;
          END IF;
          v_order := v_order || jsonb_build_array(jsonb_build_object(
            'ride_id', v_ride.id,
            'stop_id', v_stop_id,
            'seq', v_seq,
            'label', v_label,
            'latitude', v_ride.guest_dest_latitude,
            'longitude', v_ride.guest_dest_longitude,
            'route_index', v_drop_idx,
            'kind', 'guest_mid_route_drop'
          ));
          UPDATE public.commute_publications
          SET drop_order_json = v_order,
              updated_at = now()
          WHERE id = v_pub.id;
        END IF;
      END IF;
    END IF;

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
    IF v_ride.publication_id IS NOT NULL THEN
      PERFORM public.cleaner_city_release_publication_seat(v_ride.publication_id);
    END IF;
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

COMMENT ON FUNCTION public.cleaner_city_find_matches IS
  'Corridor match with on_route_drop, reason_labels, and mid-route drop chips.';
COMMENT ON FUNCTION public.cleaner_city_respond_ride_request IS
  'Accept inserts mid-route guest drop into publication stops + drop_order_json.';
