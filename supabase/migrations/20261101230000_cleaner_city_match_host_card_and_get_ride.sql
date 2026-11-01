-- Host card fields on find_matches + reliable ride fetch for participants

CREATE OR REPLACE FUNCTION public.cleaner_city_get_ride(p_ride_id uuid)
RETURNS public.rides
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_ride_id IS NULL THEN RAISE EXCEPTION 'ride_id required'; END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF NOT (
    public.is_admin(v_uid)
    OR public.is_society_admin(v_uid, v_ride.society_id)
    OR v_ride.host_user_id = v_uid
    OR v_ride.guest_user_id = v_uid
    OR public.cleaner_city_is_ride_participant(v_ride.id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_get_ride(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_get_ride(uuid) TO authenticated;

-- Patch find_matches payload: add host_name, host_avatar_url, host_flat (never society)
CREATE OR REPLACE FUNCTION public.cleaner_city_find_matches(
  p_date date,
  p_direction text DEFAULT 'to_office'::text,
  p_depart_time time without time zone DEFAULT NULL::time without time zone,
  p_guest_pickup_lat double precision DEFAULT NULL::double precision,
  p_guest_pickup_lng double precision DEFAULT NULL::double precision,
  p_guest_dest_lat double precision DEFAULT NULL::double precision,
  p_guest_dest_lng double precision DEFAULT NULL::double precision
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
  v_circle_only boolean := false;
  v_road_overlap numeric;
  v_no_shows integer := 0;
  v_open_city boolean := false;
  v_require_history boolean := false;
  v_stop_m double precision;
  v_host_completed integer := 0;
  v_vehicle_verified boolean := false;
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
      cp.company_name AS host_company,
      pr.name AS host_name,
      pr.avatar_url AS host_avatar_url,
      NULLIF(trim(COALESCE(pr.flat_number, '')), '') AS host_flat
    FROM public.commute_publications p
    JOIN public.vehicles v ON v.id = p.vehicle_id AND v.is_active = true
    LEFT JOIN public.commute_profiles cp
      ON cp.user_id = p.host_user_id AND cp.deleted_at IS NULL
    LEFT JOIN public.profiles pr ON pr.id = p.host_user_id
    WHERE p.status = 'published'
      AND p.travel_date = p_date
      AND p.direction = p_direction
      AND p.seats_available >= v_min_seats
      AND p.host_user_id <> v_uid
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

    SELECT min(public.cleaner_city_haversine_meters(
      p_guest_dest_lat, p_guest_dest_lng, s.latitude, s.longitude
    )) INTO v_stop_m
    FROM public.commute_publication_stops s
    WHERE s.publication_id = r.publication_id
      AND p_guest_dest_lat IS NOT NULL
      AND p_guest_dest_lng IS NOT NULL;
    IF v_stop_m IS NOT NULL AND v_stop_m <= (v_dest_km * 1000.0) THEN
      v_reasons := array_append(v_reasons, 'drop_near_extra_stop');
      v_score := v_score + 12;
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

    IF r.route_polyline IS NOT NULL THEN
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
      'host_name', COALESCE(NULLIF(trim(COALESCE(r.host_name, '')), ''), 'Neighbour'),
      'host_avatar_url', r.host_avatar_url,
      'host_flat', r.host_flat,
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
      'pickup_walk_meters', v_pickup_dev_m,
      'host_no_show_count', v_no_shows,
      'road_overlap_pct', v_road_overlap,
      'host_completed_rides', v_host_completed,
      'host_vehicle_verified', v_vehicle_verified,
      'extra_stop_meters', v_stop_m,
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
$function$;
