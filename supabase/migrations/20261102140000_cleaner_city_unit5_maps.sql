-- A Cleaner City Unit 5: office pins, route geometry cache, detour helpers.
-- Matching engine (Unit 6) consumes these; this unit does not book rides.

ALTER TABLE public.commute_publications
  ADD COLUMN IF NOT EXISTS origin_latitude double precision,
  ADD COLUMN IF NOT EXISTS origin_longitude double precision,
  ADD COLUMN IF NOT EXISTS destination_latitude double precision,
  ADD COLUMN IF NOT EXISTS destination_longitude double precision,
  ADD COLUMN IF NOT EXISTS origin_label text,
  ADD COLUMN IF NOT EXISTS destination_label text,
  ADD COLUMN IF NOT EXISTS route_distance_meters integer,
  ADD COLUMN IF NOT EXISTS route_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS route_provider text DEFAULT 'google';

CREATE OR REPLACE FUNCTION public.cleaner_city_upsert_office_location(
  p_latitude double precision,
  p_longitude double precision,
  p_label text DEFAULT NULL,
  p_address_text text DEFAULT NULL,
  p_is_primary boolean DEFAULT true,
  p_office_id uuid DEFAULT NULL
)
RETURNS public.office_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.office_locations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_society := public.cleaner_city_assert_schedule_access(v_uid);

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'latitude and longitude are required';
  END IF;
  IF p_latitude < -90 OR p_latitude > 90 OR p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;

  IF COALESCE(p_is_primary, true) THEN
    UPDATE public.office_locations
    SET is_primary = false, updated_at = now()
    WHERE user_id = v_uid AND is_primary = true
      AND (p_office_id IS NULL OR id <> p_office_id);
  END IF;

  IF p_office_id IS NOT NULL THEN
    UPDATE public.office_locations o
    SET
      latitude = p_latitude,
      longitude = p_longitude,
      label = NULLIF(trim(COALESCE(p_label, '')), ''),
      address_text = NULLIF(trim(COALESCE(p_address_text, '')), ''),
      is_primary = COALESCE(p_is_primary, true),
      society_id = v_society,
      updated_at = now()
    WHERE o.id = p_office_id AND o.user_id = v_uid
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Office location not found';
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO public.office_locations (
    user_id, society_id, label, address_text, latitude, longitude, is_primary, updated_at
  )
  VALUES (
    v_uid, v_society,
    NULLIF(trim(COALESCE(p_label, '')), ''),
    NULLIF(trim(COALESCE(p_address_text, '')), ''),
    p_latitude, p_longitude,
    COALESCE(p_is_primary, true),
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_upsert_office_location(
  double precision, double precision, text, text, boolean, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_upsert_office_location(
  double precision, double precision, text, text, boolean, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_store_route_geometry(
  p_publication_id uuid,
  p_route_polyline text,
  p_origin_latitude double precision DEFAULT NULL,
  p_origin_longitude double precision DEFAULT NULL,
  p_destination_latitude double precision DEFAULT NULL,
  p_destination_longitude double precision DEFAULT NULL,
  p_origin_label text DEFAULT NULL,
  p_destination_label text DEFAULT NULL,
  p_route_distance_meters integer DEFAULT NULL,
  p_route_duration_seconds integer DEFAULT NULL,
  p_route_provider text DEFAULT 'google'
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

  IF NULLIF(trim(COALESCE(p_route_polyline, '')), '') IS NULL THEN
    RAISE EXCEPTION 'route_polyline is required';
  END IF;

  UPDATE public.commute_publications p
  SET
    route_polyline = trim(p_route_polyline),
    origin_latitude = p_origin_latitude,
    origin_longitude = p_origin_longitude,
    destination_latitude = p_destination_latitude,
    destination_longitude = p_destination_longitude,
    origin_label = NULLIF(trim(COALESCE(p_origin_label, '')), ''),
    destination_label = NULLIF(trim(COALESCE(p_destination_label, '')), ''),
    route_distance_meters = p_route_distance_meters,
    route_duration_seconds = p_route_duration_seconds,
    route_provider = COALESCE(NULLIF(trim(COALESCE(p_route_provider, '')), ''), 'google'),
    updated_at = now()
  WHERE p.id = p_publication_id
    AND p.host_user_id = v_uid
    AND p.status IN ('draft', 'published', 'full')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Publication not found';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_store_route_geometry(
  uuid, text, double precision, double precision, double precision, double precision,
  text, text, integer, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_store_route_geometry(
  uuid, text, double precision, double precision, double precision, double precision,
  text, text, integer, integer, text
) TO authenticated;

-- Straight-line haversine helper (meters). Road detour uses client/edge Directions.
CREATE OR REPLACE FUNCTION public.cleaner_city_haversine_meters(
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
    ELSE (
      6371000.0 * 2 * asin(sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ))
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_haversine_meters(
  double precision, double precision, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_haversine_meters(
  double precision, double precision, double precision, double precision
) TO authenticated, service_role;

-- Approximate detour minutes from straight-line extras (fallback when Directions unavailable).
CREATE OR REPLACE FUNCTION public.cleaner_city_estimate_detour_minutes(
  p_host_origin_lat double precision,
  p_host_origin_lng double precision,
  p_host_dest_lat double precision,
  p_host_dest_lng double precision,
  p_guest_pickup_lat double precision,
  p_guest_pickup_lng double precision,
  p_guest_dest_lat double precision,
  p_guest_dest_lng double precision,
  p_avg_speed_kmh double precision DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_direct double precision;
  v_via double precision;
  v_extra_m double precision;
  v_speed_mps double precision;
  v_minutes double precision;
BEGIN
  v_direct := public.cleaner_city_haversine_meters(
    p_host_origin_lat, p_host_origin_lng, p_host_dest_lat, p_host_dest_lng
  );
  v_via :=
    COALESCE(public.cleaner_city_haversine_meters(
      p_host_origin_lat, p_host_origin_lng, p_guest_pickup_lat, p_guest_pickup_lng
    ), 0) +
    COALESCE(public.cleaner_city_haversine_meters(
      p_guest_pickup_lat, p_guest_pickup_lng, p_guest_dest_lat, p_guest_dest_lng
    ), 0) +
    COALESCE(public.cleaner_city_haversine_meters(
      p_guest_dest_lat, p_guest_dest_lng, p_host_dest_lat, p_host_dest_lng
    ), 0);

  IF v_direct IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_coords');
  END IF;

  v_extra_m := greatest(0, v_via - v_direct);
  v_speed_mps := greatest(COALESCE(p_avg_speed_kmh, 25), 5) * 1000.0 / 3600.0;
  v_minutes := (v_extra_m / v_speed_mps) / 60.0;

  RETURN jsonb_build_object(
    'ok', true,
    'method', 'haversine_fallback',
    'direct_meters', round(v_direct::numeric, 1),
    'via_meters', round(v_via::numeric, 1),
    'extra_meters', round(v_extra_m::numeric, 1),
    'estimated_detour_minutes', round(v_minutes::numeric, 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_estimate_detour_minutes(
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision, double precision,
  double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_estimate_detour_minutes(
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision, double precision,
  double precision
) TO authenticated, service_role;

COMMENT ON FUNCTION public.cleaner_city_upsert_office_location IS
  'Unit 5: owner-private office pin; geography sync via existing trigger.';
COMMENT ON FUNCTION public.cleaner_city_store_route_geometry IS
  'Unit 5: cache encoded polyline + endpoints on a host publication.';
