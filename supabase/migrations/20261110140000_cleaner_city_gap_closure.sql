-- Green City gap closure: segment fuel, departure reminders, OTP/start push,
-- guest-lock overload cleanup, autopilot uniqueness.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_route_meters double precision,
  ADD COLUMN IF NOT EXISTS drop_route_meters double precision;

CREATE OR REPLACE FUNCTION public.cleaner_city_haversine_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE 2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    ))
  END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_project_route_meters(
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision,
  p_point_lat double precision,
  p_point_lng double precision,
  p_route_distance_m double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_od double precision;
  v_op double precision;
  v_frac double precision;
BEGIN
  IF p_route_distance_m IS NULL OR p_route_distance_m <= 0 THEN
    RETURN NULL;
  END IF;
  v_od := public.cleaner_city_haversine_m(p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng);
  IF v_od IS NULL OR v_od <= 1 THEN
    RETURN NULL;
  END IF;
  v_op := public.cleaner_city_haversine_m(p_origin_lat, p_origin_lng, p_point_lat, p_point_lng);
  IF v_op IS NULL THEN
    RETURN NULL;
  END IF;
  v_frac := greatest(0.0, least(1.0, v_op / v_od));
  RETURN round((v_frac * p_route_distance_m)::numeric, 1)::double precision;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_apply_fuel_snapshot(p_ride_id uuid)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride public.rides%ROWTYPE;
  v_pub_json jsonb;
  v_dist double precision;
  v_petrol integer;
  v_total integer;
  v_host integer := 0;
  v_guest integer := 0;
  v_snapshot jsonb;
  v_guest_shares jsonb := '{}'::jsonb;
  v_segments jsonb := '[]'::jsonb;
  v_basis text := 'equal_route';
  r record;
  v_cuts double precision[];
  v_cut double precision;
  v_a double precision;
  v_b double precision;
  v_seg_paise integer;
  v_on text[];
  v_n integer;
  v_base integer;
  v_rem integer;
  v_share_map jsonb;
  v_id text;
  v_extra integer;
  v_allocated integer;
  v_start double precision;
  v_end double precision;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_dest_lat double precision;
  v_dest_lng double precision;
  v_has_segments boolean := false;
  v_guest_count integer := 0;
  i integer;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  IF v_ride.fuel_snapshot IS NOT NULL
     AND v_ride.fuel_petrol_paise_per_litre IS NOT NULL
     AND v_ride.status IN ('confirmed', 'pickup_pending', 'started', 'completed') THEN
    v_petrol := v_ride.fuel_petrol_paise_per_litre;
  ELSE
    v_petrol := public.cleaner_city_current_petrol_paise_per_litre();
  END IF;

  IF v_ride.publication_id IS NOT NULL THEN
    SELECT to_jsonb(p) INTO v_pub_json
    FROM public.commute_publications p WHERE p.id = v_ride.publication_id;
  END IF;

  v_dist := COALESCE(
    v_ride.fuel_distance_meters,
    NULLIF((v_pub_json->>'route_distance_meters')::double precision, 0)
  );

  IF v_dist IS NULL OR v_dist <= 0 THEN
    UPDATE public.rides
    SET estimated_fuel_paise = COALESCE(
          estimated_fuel_paise,
          public.cleaner_city_estimate_fuel_paise(10000, 2)
        )
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;
    RETURN v_ride;
  END IF;

  v_origin_lat := COALESCE(
    (v_pub_json->>'origin_latitude')::double precision,
    (v_pub_json->>'preferred_route_origin_lat')::double precision
  );
  v_origin_lng := COALESCE(
    (v_pub_json->>'origin_longitude')::double precision,
    (v_pub_json->>'preferred_route_origin_lng')::double precision
  );
  v_dest_lat := COALESCE(
    (v_pub_json->>'destination_latitude')::double precision,
    (v_pub_json->>'preferred_route_dest_lat')::double precision
  );
  v_dest_lng := COALESCE(
    (v_pub_json->>'destination_longitude')::double precision,
    (v_pub_json->>'preferred_route_dest_lng')::double precision
  );

  FOR r IN
    SELECT id, guest_user_id, guest_pickup_latitude, guest_pickup_longitude,
           guest_dest_latitude, guest_dest_longitude, pickup_route_meters, drop_route_meters
    FROM public.rides
    WHERE publication_id = v_ride.publication_id
      AND host_user_id = v_ride.host_user_id
      AND status IN ('confirmed', 'pickup_pending', 'started', 'completed')
  LOOP
    v_start := r.pickup_route_meters;
    v_end := r.drop_route_meters;
    IF (v_start IS NULL OR v_end IS NULL)
       AND v_origin_lat IS NOT NULL AND v_dest_lat IS NOT NULL
       AND r.guest_pickup_latitude IS NOT NULL AND r.guest_dest_latitude IS NOT NULL THEN
      v_start := public.cleaner_city_project_route_meters(
        v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
        r.guest_pickup_latitude, r.guest_pickup_longitude, v_dist
      );
      v_end := public.cleaner_city_project_route_meters(
        v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
        r.guest_dest_latitude, r.guest_dest_longitude, v_dist
      );
      IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
        v_cut := v_start; v_start := v_end; v_end := v_cut;
      END IF;
      IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end > v_start THEN
        UPDATE public.rides
        SET pickup_route_meters = v_start, drop_route_meters = v_end, updated_at = now()
        WHERE id = r.id;
        v_has_segments := true;
      END IF;
    ELSIF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end > v_start THEN
      v_has_segments := true;
    END IF;
  END LOOP;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;

  IF v_has_segments THEN
    v_basis := 'segment_route';
    SELECT array_agg(c ORDER BY c)
    INTO v_cuts
    FROM (
      SELECT DISTINCT x AS c FROM (
        SELECT 0::double precision AS x
        UNION ALL SELECT v_dist
        UNION ALL
        SELECT greatest(0, least(v_dist, pickup_route_meters))
        FROM public.rides
        WHERE publication_id = v_ride.publication_id
          AND host_user_id = v_ride.host_user_id
          AND status IN ('confirmed', 'pickup_pending', 'started', 'completed')
          AND pickup_route_meters IS NOT NULL
        UNION ALL
        SELECT greatest(0, least(v_dist, drop_route_meters))
        FROM public.rides
        WHERE publication_id = v_ride.publication_id
          AND host_user_id = v_ride.host_user_id
          AND status IN ('confirmed', 'pickup_pending', 'started', 'completed')
          AND drop_route_meters IS NOT NULL
      ) q
    ) s;

    FOR i IN 1..(coalesce(array_length(v_cuts, 1), 1) - 1) LOOP
      v_a := v_cuts[i];
      v_b := v_cuts[i + 1];
      IF v_b <= v_a THEN CONTINUE; END IF;
      v_seg_paise := round(((v_b - v_a) / 1000.0) * (v_petrol::numeric / 10.0))::integer;
      v_on := ARRAY['host'];
      FOR r IN
        SELECT guest_user_id::text AS gid, pickup_route_meters AS sm, drop_route_meters AS em
        FROM public.rides
        WHERE publication_id = v_ride.publication_id
          AND host_user_id = v_ride.host_user_id
          AND status IN ('confirmed', 'pickup_pending', 'started', 'completed')
          AND pickup_route_meters IS NOT NULL
          AND drop_route_meters IS NOT NULL
      LOOP
        IF r.sm < v_b AND r.em > v_a THEN
          v_on := array_append(v_on, r.gid);
          IF NOT (v_guest_shares ? r.gid) THEN
            v_guest_shares := v_guest_shares || jsonb_build_object(r.gid, 0);
          END IF;
        END IF;
      END LOOP;
      v_n := greatest(coalesce(array_length(v_on, 1), 1), 1);
      v_base := floor(v_seg_paise::numeric / v_n)::integer;
      v_rem := v_seg_paise - (v_base * v_n);
      v_share_map := '{}'::jsonb;
      FOREACH v_id IN ARRAY v_on LOOP
        v_extra := CASE WHEN v_rem > 0 THEN 1 ELSE 0 END;
        IF v_rem > 0 THEN v_rem := v_rem - 1; END IF;
        v_share_map := v_share_map || jsonb_build_object(v_id, v_base + v_extra);
      END LOOP;
      v_host := v_host + COALESCE((v_share_map->>'host')::integer, 0);
      FOR r IN SELECT key, value FROM jsonb_each_text(v_share_map) WHERE key <> 'host'
      LOOP
        v_guest_shares := jsonb_set(
          v_guest_shares,
          ARRAY[r.key],
          to_jsonb(COALESCE((v_guest_shares->>r.key)::integer, 0) + r.value::integer),
          true
        );
      END LOOP;
      v_segments := v_segments || jsonb_build_array(jsonb_build_object(
        'start_meters', v_a,
        'end_meters', v_b,
        'participant_ids', to_jsonb(v_on),
        'fuel_paise', v_seg_paise,
        'share_paise', v_base
      ));
    END LOOP;

    v_total := 0;
    FOR r IN SELECT value FROM jsonb_array_elements(v_segments)
    LOOP
      v_total := v_total + COALESCE((r.value->>'fuel_paise')::integer, 0);
    END LOOP;
    v_allocated := v_host;
    FOR r IN SELECT value FROM jsonb_each_text(v_guest_shares)
    LOOP
      v_allocated := v_allocated + r.value::integer;
    END LOOP;
    IF v_allocated <> v_total THEN
      v_host := v_host + (v_total - v_allocated);
    END IF;
    v_guest := COALESCE((v_guest_shares->>v_ride.guest_user_id::text)::integer, 0);
    SELECT count(*)::integer INTO v_guest_count FROM jsonb_object_keys(v_guest_shares);
  ELSE
    SELECT count(*)::integer INTO v_n
    FROM public.rides rr
    WHERE rr.publication_id = v_ride.publication_id
      AND rr.status IN ('confirmed', 'pickup_pending', 'started', 'completed')
      AND rr.host_user_id = v_ride.host_user_id;
    IF v_n IS NULL OR v_n < 1 THEN v_n := 1; END IF;
    v_n := 1 + v_n;
    v_total := round((v_dist / 1000.0) * (v_petrol::numeric / 10.0))::integer;
    v_guest := round(v_total::numeric / v_n)::integer;
    v_host := v_total - (v_guest * (v_n - 1));
    v_guest_shares := jsonb_build_object(v_ride.guest_user_id::text, v_guest);
    v_segments := jsonb_build_array(jsonb_build_object(
      'start_meters', 0,
      'end_meters', v_dist,
      'participant_ids', jsonb_build_array('host', v_ride.guest_user_id::text),
      'fuel_paise', v_total,
      'share_paise', v_guest
    ));
    v_guest_count := 1;
    v_basis := 'equal_route';
  END IF;

  v_snapshot := jsonb_build_object(
    'petrol_paise_per_litre', v_petrol,
    'mileage_km_per_litre', 10,
    'distance_meters', v_dist,
    'fuel_paise_per_km', round(v_petrol::numeric / 10.0)::integer,
    'total_fuel_paise', v_total,
    'host_share_paise', v_host,
    'guest_share_paise', v_guest,
    'guest_shares', v_guest_shares,
    'participants', 1 + coalesce(v_guest_count, 0),
    'segments', v_segments,
    'calc_version', 2,
    'calculated_at', now(),
    'basis', v_basis
  );

  UPDATE public.rides
  SET
    estimated_fuel_paise = v_guest,
    fuel_snapshot = v_snapshot,
    fuel_petrol_paise_per_litre = v_petrol,
    fuel_mileage_km_per_litre = 10,
    fuel_distance_meters = v_dist,
    fuel_total_paise = v_total,
    fuel_host_share_paise = v_host,
    fuel_calc_version = 2
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_apply_fuel_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_apply_fuel_snapshot(uuid) TO authenticated, service_role;
