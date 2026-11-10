-- Offer control + Extra trips + Prefer circles
-- Phase A: cancel live commute pubs on pause / WFH
-- Phase B: trip_kind extra + publish RPC + find includes extras
-- Phase C: prefer_circle_matching ranking boost

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.commute_publications
  ADD COLUMN IF NOT EXISTS trip_kind text NOT NULL DEFAULT 'commute';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commute_publications_trip_kind_check'
  ) THEN
    ALTER TABLE public.commute_publications
      ADD CONSTRAINT commute_publications_trip_kind_check
      CHECK (trip_kind IN ('commute', 'extra'));
  END IF;
END $$;

UPDATE public.commute_publications
SET trip_kind = 'commute'
WHERE trip_kind IS NULL OR trip_kind = '';

-- Allow direction = extra for non-commute trips
DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'commute_publications'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%direction%'
  LOOP
    EXECUTE format('ALTER TABLE public.commute_publications DROP CONSTRAINT IF EXISTS %I', v_con);
  END LOOP;
END $$;

ALTER TABLE public.commute_publications
  ADD CONSTRAINT commute_publications_direction_check
  CHECK (direction IN ('to_office', 'to_home', 'extra'));

-- Commute uniqueness only (extras may have multiple per day)
DROP INDEX IF EXISTS public.commute_publications_host_date_dir_open_uidx;
DROP INDEX IF EXISTS public.uq_commute_publications_host_date_dir_active;

CREATE UNIQUE INDEX IF NOT EXISTS commute_publications_host_date_dir_open_uidx
  ON public.commute_publications (host_user_id, travel_date, direction)
  WHERE status IN ('draft', 'published', 'full')
    AND COALESCE(trip_kind, 'commute') = 'commute';

ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS prefer_circle_matching boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.commute_profiles.prefer_circle_matching IS
  'Ranking boost for shared-circle guests; does not hide host from society Find.';

COMMENT ON COLUMN public.commute_publications.trip_kind IS
  'commute = home/office Auto-offer or Offer; extra = going somewhere else.';

-- ---------------------------------------------------------------------------
-- Phase A: pause cancels open commute inventory from today forward
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_pause_commute(p_paused boolean)
RETURNS public.commute_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_profiles;
  v_today date := (timezone('Asia/Kolkata', now()))::date;
BEGIN
  PERFORM public.cleaner_city_assert_schedule_access(v_uid);

  UPDATE public.commute_profiles
  SET is_paused = COALESCE(p_paused, true), updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required before editing schedule';
  END IF;

  IF COALESCE(p_paused, true) THEN
    UPDATE public.commute_publications
    SET status = 'cancelled', updated_at = now()
    WHERE host_user_id = v_uid
      AND travel_date >= v_today
      AND status IN ('draft', 'published', 'full')
      AND COALESCE(trip_kind, 'commute') = 'commute';
  END IF;

  RETURN v_row;
END;
$$;

-- WFH cancels live commute seats for that date (not drafts only)
CREATE OR REPLACE FUNCTION public.cleaner_city_mark_wfh(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_cancelled integer := 0;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'date is required';
  END IF;
  v_society := public.get_user_society_id(v_uid);
  INSERT INTO public.commute_overrides (
    user_id, society_id, override_date, is_working, note, updated_at
  ) VALUES (
    v_uid, v_society, p_date, false, 'WFH', now()
  )
  ON CONFLICT (user_id, override_date) DO UPDATE
  SET is_working = false, note = 'WFH', updated_at = now();

  UPDATE public.commute_publications
  SET status = 'cancelled', updated_at = now()
  WHERE host_user_id = v_uid
    AND travel_date = p_date
    AND status IN ('draft', 'published', 'full')
    AND COALESCE(trip_kind, 'commute') = 'commute';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object(
    'date', p_date,
    'is_working', false,
    'commute_seats_cancelled', v_cancelled
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Phase C: discovery prefs include prefer_circle_matching
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cleaner_city_set_discovery_prefs(boolean, text, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.cleaner_city_set_discovery_prefs(
  p_circle_only boolean,
  p_visibility text,
  p_show_on_board boolean,
  p_require_circle_history boolean,
  p_open_city boolean,
  p_prefer_circle boolean DEFAULT false
)
RETURNS public.commute_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_profiles;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_visibility IS NULL OR p_visibility NOT IN ('members', 'private') THEN
    RAISE EXCEPTION 'visibility must be members or private';
  END IF;
  UPDATE public.commute_profiles
  SET circle_only_matching = COALESCE(p_circle_only, false),
      circle_visibility = p_visibility,
      show_on_circle_board = COALESCE(p_show_on_board, false),
      require_circle_history = COALESCE(p_require_circle_history, false),
      open_city_matching = COALESCE(p_open_city, false),
      prefer_circle_matching = COALESCE(p_prefer_circle, false),
      updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_discovery_prefs(boolean, text, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_discovery_prefs(boolean, text, boolean, boolean, boolean, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Phase B: publish Extra trip
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_publish_extra_trip(
  p_vehicle_id uuid,
  p_travel_date date,
  p_depart_time time,
  p_seats_available integer,
  p_route_polyline text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision,
  p_origin_label text DEFAULT 'Pickup',
  p_dest_label text DEFAULT 'Destination',
  p_route_distance_meters integer DEFAULT NULL,
  p_route_duration_seconds integer DEFAULT NULL
)
RETURNS public.commute_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_profile public.commute_profiles;
  v_vehicle public.vehicles;
  v_poly text;
  v_seats integer;
  v_overlap boolean;
  v_row public.commute_publications;
  v_depart_min integer := 30;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;

  SELECT * INTO v_profile
  FROM public.commute_profiles
  WHERE user_id = v_uid AND deleted_at IS NULL;
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;
  IF v_profile.role NOT IN ('host', 'both') THEN
    RAISE EXCEPTION 'Host role required';
  END IF;
  IF COALESCE(v_profile.is_paused, false) THEN
    RAISE EXCEPTION 'Unpause commute before offering an Extra trip';
  END IF;

  IF p_travel_date IS NULL OR p_travel_date < (timezone('Asia/Kolkata', now()))::date THEN
    RAISE EXCEPTION 'travel_date must be today or later';
  END IF;
  IF p_depart_time IS NULL THEN
    RAISE EXCEPTION 'depart_time is required';
  END IF;
  IF p_origin_lat IS NULL OR p_origin_lng IS NULL OR p_dest_lat IS NULL OR p_dest_lng IS NULL THEN
    RAISE EXCEPTION 'origin and destination pins are required';
  END IF;

  v_poly := NULLIF(trim(COALESCE(p_route_polyline, '')), '');
  IF v_poly IS NULL THEN
    RAISE EXCEPTION 'route polyline is required';
  END IF;
  PERFORM public.cleaner_city_assert_publishable_polyline(
    v_poly, p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, 8, 2500
  );

  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id AND user_id = v_uid AND is_active = true;
  IF v_vehicle.id IS NULL THEN
    RAISE EXCEPTION 'Active vehicle required';
  END IF;

  v_seats := COALESCE(p_seats_available, v_vehicle.seat_capacity);
  IF v_seats < 1 OR v_seats > v_vehicle.seat_capacity THEN
    RAISE EXCEPTION 'seats_available must be between 1 and vehicle capacity';
  END IF;

  -- Block Extra when an open commute seat overlaps this depart window.
  SELECT EXISTS (
    SELECT 1
    FROM public.commute_publications p
    WHERE p.host_user_id = v_uid
      AND p.travel_date = p_travel_date
      AND COALESCE(p.trip_kind, 'commute') = 'commute'
      AND p.status IN ('draft', 'published', 'full')
      AND abs(EXTRACT(EPOCH FROM (p.depart_time - p_depart_time)) / 60.0) <= v_depart_min
  ) INTO v_overlap;

  IF v_overlap THEN
    RAISE EXCEPTION
      'Cancel or turn off your overlapping commute seat first (within 30 minutes of that leave time)';
  END IF;

  INSERT INTO public.commute_publications (
    host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
    seats_available, seats_total, status, route_polyline,
    route_distance_meters, route_duration_seconds, route_provider,
    origin_latitude, origin_longitude, destination_latitude, destination_longitude,
    origin_label, destination_label, trip_kind, updated_at
  ) VALUES (
    v_uid, v_society, v_vehicle.id, p_travel_date, 'extra', p_depart_time,
    v_seats, v_vehicle.seat_capacity, 'published', v_poly,
    p_route_distance_meters, p_route_duration_seconds, 'google',
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng,
    COALESCE(NULLIF(trim(p_origin_label), ''), 'Pickup'),
    COALESCE(NULLIF(trim(p_dest_label), ''), 'Destination'),
    'extra',
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_publish_extra_trip(
  uuid, date, time, integer, text,
  double precision, double precision, double precision, double precision,
  text, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_publish_extra_trip(
  uuid, date, time, integer, text,
  double precision, double precision, double precision, double precision,
  text, text, integer, integer
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Find: include Extra trips + prefer-circle host boost
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
      COALESCE(p.trip_kind, 'commute') AS trip_kind,
      v.vehicle_type, v.color AS vehicle_color,
      cp.company_name AS host_company,
      COALESCE(cp.prefer_circle_matching, false) AS prefer_circle_matching
    FROM public.commute_publications p
    JOIN public.vehicles v ON v.id = p.vehicle_id AND v.is_active = true
    LEFT JOIN public.commute_profiles cp
      ON cp.user_id = p.host_user_id AND cp.deleted_at IS NULL
    WHERE p.status = 'published'
      AND p.travel_date = p_date
      AND (
        (COALESCE(p.trip_kind, 'commute') = 'commute' AND p.direction = p_direction)
        OR COALESCE(p.trip_kind, 'commute') = 'extra'
      )
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
      IF COALESCE(r.prefer_circle_matching, false) THEN
        v_reasons := array_append(v_reasons, 'host_prefers_circle');
        v_score := v_score + 15;
      END IF;
    ELSIF COALESCE(v_circle_only, false) OR COALESCE(v_require_history, false) THEN
      CONTINUE;
    END IF;
    IF COALESCE(r.trip_kind, 'commute') = 'extra' THEN
      v_reasons := array_append(v_reasons, 'extra_trip');
      v_score := v_score + 5;
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
      BEGIN
        v_labels := array_append(v_labels, public.cleaner_city_match_reason_label(v_code));
      EXCEPTION WHEN OTHERS THEN
        v_labels := array_append(v_labels, replace(v_code, '_', ' '));
      END;
    END LOOP;

    v_item := jsonb_build_object(
      'publication_id', r.publication_id,
      'host_user_id', r.host_user_id,
      'society_id', r.society_id,
      'travel_date', r.travel_date,
      'direction', r.direction,
      'trip_kind', COALESCE(r.trip_kind, 'commute'),
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

COMMENT ON FUNCTION public.cleaner_city_find_matches IS
  'Corridor Find for commute legs plus Extra trips; circle boost + prefer-circle host ranking.';
