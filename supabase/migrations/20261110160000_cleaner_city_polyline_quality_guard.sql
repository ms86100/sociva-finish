-- Reject sparse / geographically invalid route geometry on store + publish.
-- Prevents placeholder overview polylines (~Pacific) from entering matching inventory.

CREATE OR REPLACE FUNCTION public.cleaner_city_assert_publishable_polyline(
  p_polyline text,
  p_origin_lat double precision DEFAULT NULL,
  p_origin_lng double precision DEFAULT NULL,
  p_dest_lat double precision DEFAULT NULL,
  p_dest_lng double precision DEFAULT NULL,
  p_min_points integer DEFAULT 8,
  p_max_endpoint_snap_m double precision DEFAULT 2500
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_poly text := NULLIF(trim(COALESCE(p_polyline, '')), '');
  v_origin jsonb;
  v_dest jsonb;
  v_points integer;
  v_origin_m double precision;
  v_dest_m double precision;
BEGIN
  IF v_poly IS NULL OR length(v_poly) < 10 THEN
    RAISE EXCEPTION 'Driving route polyline is required to publish a ride';
  END IF;

  IF p_origin_lat IS NOT NULL AND p_origin_lng IS NOT NULL THEN
    v_origin := public.cleaner_city_project_point_on_polyline(
      v_poly, p_origin_lat, p_origin_lng, 250
    );
    v_points := COALESCE((v_origin->>'points_scanned')::integer, 0);
    v_origin_m := COALESCE((v_origin->>'distance_m')::double precision, 1e12);
    IF v_points < greatest(COALESCE(p_min_points, 8), 3) THEN
      RAISE EXCEPTION 'Route geometry is too sparse to match guests - rebuild the usual road with Google Directions';
    END IF;
    IF v_origin_m > COALESCE(p_max_endpoint_snap_m, 2500) THEN
      RAISE EXCEPTION 'Saved route does not start near the pickup pin - rebuild the usual road, then publish';
    END IF;
  END IF;

  IF p_dest_lat IS NOT NULL AND p_dest_lng IS NOT NULL THEN
    v_dest := public.cleaner_city_project_point_on_polyline(
      v_poly, p_dest_lat, p_dest_lng, 250
    );
    v_points := COALESCE(v_points, (v_dest->>'points_scanned')::integer, 0);
    v_dest_m := COALESCE((v_dest->>'distance_m')::double precision, 1e12);
    IF v_points < greatest(COALESCE(p_min_points, 8), 3) THEN
      RAISE EXCEPTION 'Route geometry is too sparse to match guests - rebuild the usual road with Google Directions';
    END IF;
    IF v_dest_m > COALESCE(p_max_endpoint_snap_m, 2500) THEN
      RAISE EXCEPTION 'Saved route does not end near the drop pin - rebuild the usual road, then publish';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_assert_publishable_polyline(
  text, double precision, double precision, double precision, double precision, integer, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_assert_publishable_polyline(
  text, double precision, double precision, double precision, double precision, integer, double precision
) TO authenticated, service_role;

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
  v_poly text := NULLIF(trim(COALESCE(p_route_polyline, '')), '');
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  IF v_poly IS NULL THEN
    RAISE EXCEPTION 'route_polyline is required';
  END IF;

  IF lower(trim(COALESCE(p_route_provider, ''))) = 'haversine_fallback' THEN
    RAISE EXCEPTION 'A real driving road is required before publishing';
  END IF;

  PERFORM public.cleaner_city_assert_publishable_polyline(
    v_poly,
    p_origin_latitude,
    p_origin_longitude,
    p_destination_latitude,
    p_destination_longitude,
    8,
    2500
  );

  UPDATE public.commute_publications p
  SET
    route_polyline = v_poly,
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

COMMENT ON FUNCTION public.cleaner_city_assert_publishable_polyline IS
  'GC audit: reject sparse or geographically invalid polylines before they enter match inventory.';
