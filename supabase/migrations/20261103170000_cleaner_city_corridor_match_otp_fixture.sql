-- GC-01: corridor matching via polyline projection + pickup-before-drop sequence
-- GC-02: require route polyline on publish; skip match candidates without geometry
-- OTP: passenger-held (guest generates, host enters to start)
-- Test-only work-email fixture: service_role + @sociva.test only

-- ---------------------------------------------------------------------------
-- Project a lat/lng onto an encoded Google polyline (sampled points).
-- Returns distance_m, index along path, and nearest point.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_project_point_on_polyline(
  p_polyline text,
  p_lat double precision,
  p_lng double precision,
  p_max_points integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_i integer := 1;
  v_len integer;
  v_lat bigint := 0;
  v_lng bigint := 0;
  v_shift integer;
  v_result bigint;
  v_b integer;
  v_points integer := 0;
  v_best_d double precision := 1e12;
  v_best_i integer := -1;
  v_best_lat double precision;
  v_best_lng double precision;
  v_d double precision;
  v_plat double precision;
  v_plng double precision;
  v_ch text;
  v_max integer := GREATEST(20, LEAST(COALESCE(p_max_points, 250), 500));
BEGIN
  IF p_polyline IS NULL OR length(trim(p_polyline)) < 2 THEN
    RETURN NULL;
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN NULL;
  END IF;

  v_len := length(p_polyline);
  WHILE v_i <= v_len AND v_points < v_max LOOP
    v_shift := 0;
    v_result := 0;
    LOOP
      EXIT WHEN v_i > v_len;
      v_ch := substr(p_polyline, v_i, 1);
      v_i := v_i + 1;
      v_b := ascii(v_ch) - 63;
      v_result := v_result | public.cleaner_city_shl((v_b & 31)::bigint, v_shift);
      v_shift := v_shift + 5;
      EXIT WHEN v_b < 32;
    END LOOP;
    IF (v_result & 1) = 1 THEN
      v_lat := v_lat + (~(v_result >> 1));
    ELSE
      v_lat := v_lat + (v_result >> 1);
    END IF;

    v_shift := 0;
    v_result := 0;
    LOOP
      EXIT WHEN v_i > v_len;
      v_ch := substr(p_polyline, v_i, 1);
      v_i := v_i + 1;
      v_b := ascii(v_ch) - 63;
      v_result := v_result | public.cleaner_city_shl((v_b & 31)::bigint, v_shift);
      v_shift := v_shift + 5;
      EXIT WHEN v_b < 32;
    END LOOP;
    IF (v_result & 1) = 1 THEN
      v_lng := v_lng + (~(v_result >> 1));
    ELSE
      v_lng := v_lng + (v_result >> 1);
    END IF;

    v_plat := v_lat / 100000.0;
    v_plng := v_lng / 100000.0;
    v_d := public.cleaner_city_haversine_meters(p_lat, p_lng, v_plat, v_plng);
    IF v_d < v_best_d THEN
      v_best_d := v_d;
      v_best_i := v_points;
      v_best_lat := v_plat;
      v_best_lng := v_plng;
    END IF;
    v_points := v_points + 1;
  END LOOP;

  IF v_points = 0 OR v_best_i < 0 THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'distance_m', round(v_best_d::numeric, 1),
    'index', v_best_i,
    'point_lat', v_best_lat,
    'point_lng', v_best_lng,
    'points_scanned', v_points
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_project_point_on_polyline(text, double precision, double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_project_point_on_polyline(text, double precision, double precision, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleaner_city_project_point_on_polyline(text, double precision, double precision, integer) TO service_role;

COMMENT ON FUNCTION public.cleaner_city_project_point_on_polyline IS
  'GC-01: nearest sampled polyline point + along-route index for corridor matching.';

-- Keep legacy overlap helper but derive from projection (more points, shared math).
CREATE OR REPLACE FUNCTION public.cleaner_city_polyline_overlap_pct(
  p_polyline text,
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v1 jsonb;
  v2 jsonb;
  v_best1 double precision;
  v_best2 double precision;
  v_avg double precision;
BEGIN
  v1 := public.cleaner_city_project_point_on_polyline(p_polyline, p_lat1, p_lng1, 250);
  v2 := public.cleaner_city_project_point_on_polyline(p_polyline, p_lat2, p_lng2, 250);
  IF v1 IS NULL OR v2 IS NULL THEN
    RETURN NULL;
  END IF;
  v_best1 := (v1->>'distance_m')::double precision;
  v_best2 := (v2->>'distance_m')::double precision;
  IF v_best1 > 800 AND v_best2 > 800 THEN
    RETURN 0;
  END IF;
  v_avg := (v_best1 + v_best2) / 2.0;
  RETURN round(GREATEST(0, 100.0 * (1.0 - LEAST(1.0, v_avg / 800.0)))::numeric, 1);
END;
$$;

-- ---------------------------------------------------------------------------
-- Publish: polyline required (GC-02)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_publish_commute(
  p_vehicle_id uuid,
  p_travel_date date,
  p_direction text DEFAULT 'to_office',
  p_depart_time time DEFAULT NULL,
  p_seats_available integer DEFAULT NULL,
  p_route_polyline text DEFAULT NULL,
  p_publication_id uuid DEFAULT NULL
)
RETURNS public.commute_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_vehicle public.vehicles;
  v_seats integer;
  v_depart time;
  v_effective jsonb;
  v_row public.commute_publications;
  v_office record;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_dest_lat double precision;
  v_dest_lng double precision;
  v_origin_label text;
  v_dest_label text;
  v_poly text;
BEGIN
  v_society := public.cleaner_city_assert_host_access(v_uid);

  IF p_travel_date IS NULL OR p_travel_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'travel_date must be today or a future date';
  END IF;

  IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;

  v_poly := NULLIF(trim(COALESCE(p_route_polyline, '')), '');
  IF v_poly IS NULL OR length(v_poly) < 10 THEN
    RAISE EXCEPTION 'Driving route polyline is required to publish a ride';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id AND user_id = v_uid AND is_active = true;

  IF v_vehicle.id IS NULL THEN
    RAISE EXCEPTION 'Active vehicle required to publish a ride';
  END IF;

  v_effective := public.cleaner_city_effective_schedule(v_uid, p_travel_date);
  IF COALESCE((v_effective->>'is_paused')::boolean, false) THEN
    RAISE EXCEPTION 'Commute is paused - resume before publishing';
  END IF;
  IF NOT COALESCE((v_effective->>'is_working')::boolean, false) THEN
    RAISE EXCEPTION 'Not commuting on this date - update schedule or override first';
  END IF;

  SELECT * INTO v_office
  FROM public.office_locations o
  WHERE o.user_id = v_uid
  ORDER BY o.is_primary DESC, o.updated_at DESC
  LIMIT 1;

  IF v_office.id IS NULL
     OR v_office.latitude IS NULL OR v_office.longitude IS NULL
     OR v_office.latitude < -90 OR v_office.latitude > 90
     OR v_office.longitude < -180 OR v_office.longitude > 180 THEN
    RAISE EXCEPTION 'Valid office coordinates required before publishing';
  END IF;

  IF (v_effective->>'pickup_latitude') IS NULL
     OR (v_effective->>'pickup_longitude') IS NULL THEN
    RAISE EXCEPTION 'Valid pickup coordinates required before publishing';
  END IF;

  v_origin_lat := (v_effective->>'pickup_latitude')::double precision;
  v_origin_lng := (v_effective->>'pickup_longitude')::double precision;
  IF v_origin_lat < -90 OR v_origin_lat > 90 OR v_origin_lng < -180 OR v_origin_lng > 180 THEN
    RAISE EXCEPTION 'Pickup coordinates out of range';
  END IF;

  IF p_direction = 'to_office' THEN
    v_depart := COALESCE(p_depart_time, (v_effective->>'depart_time')::time);
    v_dest_lat := v_office.latitude;
    v_dest_lng := v_office.longitude;
    v_origin_label := COALESCE(v_effective->>'pickup_label', 'Pickup');
    v_dest_label := COALESCE(v_office.label, 'Office');
  ELSE
    v_depart := COALESCE(p_depart_time, (v_effective->>'return_time')::time);
    v_dest_lat := v_origin_lat;
    v_dest_lng := v_origin_lng;
    v_origin_lat := v_office.latitude;
    v_origin_lng := v_office.longitude;
    v_origin_label := COALESCE(v_office.label, 'Office');
    v_dest_label := COALESCE(v_effective->>'pickup_label', 'Home');
  END IF;

  IF v_depart IS NULL THEN
    RAISE EXCEPTION 'depart_time required to publish';
  END IF;

  v_seats := COALESCE(p_seats_available, v_vehicle.seat_capacity);
  IF v_seats IS NULL OR v_seats < 1 THEN
    RAISE EXCEPTION 'seats_available must be at least 1';
  END IF;
  IF v_seats > v_vehicle.seat_capacity THEN
    RAISE EXCEPTION 'Cannot publish more seats than vehicle capacity';
  END IF;
  IF v_vehicle.vehicle_type = 'bike' AND v_seats > 1 THEN
    RAISE EXCEPTION 'Bike publications cannot offer more than 1 passenger seat';
  END IF;

  IF p_publication_id IS NOT NULL THEN
    UPDATE public.commute_publications p
    SET
      vehicle_id = p_vehicle_id,
      travel_date = p_travel_date,
      direction = p_direction,
      depart_time = v_depart,
      seats_available = v_seats,
      seats_total = v_vehicle.seat_capacity,
      route_polyline = v_poly,
      origin_latitude = v_origin_lat,
      origin_longitude = v_origin_lng,
      destination_latitude = v_dest_lat,
      destination_longitude = v_dest_lng,
      origin_label = v_origin_label,
      destination_label = v_dest_label,
      status = 'published',
      society_id = v_society,
      updated_at = now()
    WHERE p.id = p_publication_id
      AND p.host_user_id = v_uid
      AND p.status IN ('draft', 'published')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Publication not found or not editable';
    END IF;
    IF v_row.route_polyline IS NULL OR length(trim(v_row.route_polyline)) < 10 THEN
      RAISE EXCEPTION 'Driving route polyline is required to publish a ride';
    END IF;
    PERFORM public.cleaner_city_notify_waitlist_for_publication(v_row.id, true);
    RETURN v_row;
  END IF;

  UPDATE public.commute_publications
  SET status = 'cancelled', updated_at = now()
  WHERE host_user_id = v_uid
    AND travel_date = p_travel_date
    AND direction = p_direction
    AND status IN ('draft', 'published');

  INSERT INTO public.commute_publications (
    host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
    seats_available, seats_total, status, route_polyline,
    origin_latitude, origin_longitude, destination_latitude, destination_longitude,
    origin_label, destination_label, updated_at
  )
  VALUES (
    v_uid, v_society, p_vehicle_id, p_travel_date, p_direction, v_depart,
    v_seats, v_vehicle.seat_capacity, 'published',
    v_poly,
    v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
    v_origin_label, v_dest_label, now()
  )
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_notify_waitlist_for_publication(v_row.id, true);
  RETURN v_row;
END;
$$;

-- Soft-withdraw published rides that lack geometry so they cannot match.
UPDATE public.commute_publications
SET status = 'cancelled',
    updated_at = now()
WHERE status = 'published'
  AND (route_polyline IS NULL OR length(trim(route_polyline)) < 10);

-- ---------------------------------------------------------------------------
-- Matching: corridor projection primary gate (GC-01)
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

    -- Corridor projection (primary geometry gate)
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
    -- Pickup must occur before drop along the driver's selected route
    IF v_pick_idx IS NULL OR v_drop_idx IS NULL OR v_pick_idx >= v_drop_idx THEN
      CONTINUE;
    END IF;

    v_reasons := array_append(v_reasons, 'pickup_on_route_corridor');
    v_score := v_score + 25;
    v_reasons := array_append(v_reasons, 'drop_on_route_corridor');
    v_score := v_score + 20;
    v_reasons := array_append(v_reasons, 'pickup_before_drop');
    v_score := v_score + 15;

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

    -- Soft bonus if guest dest also near host end or an extra stop
    IF v_host_dest_lat IS NOT NULL AND v_host_dest_lng IS NOT NULL THEN
      IF public.cleaner_city_haversine_meters(
        p_guest_dest_lat, p_guest_dest_lng, v_host_dest_lat, v_host_dest_lng
      ) <= (v_dest_km * 1000.0) THEN
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
      'hard_route_overlap', v_hard_overlap,
      'require_route_polyline', true,
      'matching_mode', 'polyline_corridor'
    ),
    'matches', (
      SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'score')::numeric DESC), '[]'::jsonb)
      FROM jsonb_array_elements(v_results) elem
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- OTP: passenger generates, host/rider starts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_generate_ride_otp(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_code text;
  v_hash text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.guest_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the passenger can generate the pickup OTP';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending') THEN
    RAISE EXCEPTION 'OTP only available after confirmation';
  END IF;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := encode(
    extensions.digest(convert_to(v_code || ':' || p_ride_id::text, 'UTF8'), 'sha256'),
    'hex'
  );

  UPDATE public.rides
  SET
    pickup_otp_hash = v_hash,
    pickup_otp_expires_at = now() + interval '30 minutes',
    pickup_otp_attempt_count = 0,
    status = 'pickup_pending',
    updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'otp_generated',
    'confirmed', 'pickup_pending', jsonb_build_object('holder', 'passenger')
  );

  RETURN jsonb_build_object(
    'ride_id', v_ride.id,
    'otp', v_code,
    'expires_at', v_ride.pickup_otp_expires_at,
    'status', v_ride.status,
    'holder', 'passenger'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_start_ride(
  p_ride_id uuid,
  p_otp text
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_hash text;
  v_from text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the rider can start the trip with the passenger OTP';
  END IF;
  IF v_ride.status <> 'pickup_pending' THEN
    RAISE EXCEPTION 'Ride is not awaiting OTP start';
  END IF;
  IF v_ride.pickup_otp_expires_at IS NULL OR v_ride.pickup_otp_expires_at < now() THEN
    RAISE EXCEPTION 'OTP expired - passenger must generate a new one';
  END IF;
  IF COALESCE(v_ride.pickup_otp_attempt_count, 0) >= 5 THEN
    UPDATE public.rides
    SET status = 'verification_failed', updated_at = now()
    WHERE id = p_ride_id;
    RAISE EXCEPTION 'Too many OTP attempts';
  END IF;

  v_hash := encode(
    extensions.digest(convert_to(trim(p_otp) || ':' || p_ride_id::text, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_hash IS DISTINCT FROM v_ride.pickup_otp_hash THEN
    UPDATE public.rides
    SET pickup_otp_attempt_count = pickup_otp_attempt_count + 1, updated_at = now()
    WHERE id = p_ride_id;
    RAISE EXCEPTION 'Invalid OTP';
  END IF;

  v_from := v_ride.status;
  UPDATE public.rides
  SET
    status = 'started',
    started_at = now(),
    pickup_otp_hash = NULL,
    pickup_otp_expires_at = NULL,
    updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'started', v_from, 'started', '{}'::jsonb
  );

  RETURN v_ride;
END;
$$;

COMMENT ON FUNCTION public.cleaner_city_generate_ride_otp IS
  'Passenger-held pickup OTP: guest generates; plaintext returned once to guest UI.';
COMMENT ON FUNCTION public.cleaner_city_start_ride IS
  'Host/rider enters passenger OTP to start; invalid/expired/reuse rejected.';

-- ---------------------------------------------------------------------------
-- Test-only work-email fixture (service_role + @sociva.test only)
-- Does not grant to authenticated/anon - never callable from the app JWT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_test_verify_work_email(
  p_user_id uuid,
  p_email text DEFAULT 'rider@sociva.test'
)
RETURNS public.work_verifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_society uuid;
  v_row public.work_verifications;
  v_jwt_role text := COALESCE(
    current_setting('request.jwt.claim.role', true),
    current_setting('request.jwt.claims', true)::json->>'role',
    ''
  );
BEGIN
  -- App JWTs must never succeed. Service role / postgres (MCP, scripts) may.
  IF v_jwt_role IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Test work-email fixture is not available to app clients';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  IF v_email !~ '^[a-z0-9._%+-]+@sociva\.test$' THEN
    RAISE EXCEPTION 'Test fixture email must use @sociva.test';
  END IF;

  v_society := public.get_user_society_id(p_user_id);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required for test verification';
  END IF;

  UPDATE public.work_verifications
  SET status = 'revoked', otp_hash = NULL, updated_at = now()
  WHERE user_id = p_user_id AND status = 'verified';

  INSERT INTO public.work_verifications (
    user_id, society_id, email, domain_id, status,
    verified_at, expires_at, otp_hash, otp_expires_at, otp_attempt_count, updated_at
  )
  VALUES (
    p_user_id, v_society, v_email, NULL, 'verified',
    now(), now() + interval '30 days', NULL, NULL, 0, now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_test_verify_work_email(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleaner_city_test_verify_work_email(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.cleaner_city_test_verify_work_email(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cleaner_city_test_verify_work_email(uuid, text) TO service_role;

COMMENT ON FUNCTION public.cleaner_city_test_verify_work_email IS
  'TEST ONLY: service_role marks @sociva.test work email verified. Not granted to app roles.';
