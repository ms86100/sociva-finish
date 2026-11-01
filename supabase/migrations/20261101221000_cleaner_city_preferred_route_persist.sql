-- Persist last chosen home->office driving route on commute_profiles

ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS preferred_route_polyline text,
  ADD COLUMN IF NOT EXISTS preferred_route_distance_meters integer,
  ADD COLUMN IF NOT EXISTS preferred_route_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS preferred_route_summary text,
  ADD COLUMN IF NOT EXISTS preferred_route_origin_lat double precision,
  ADD COLUMN IF NOT EXISTS preferred_route_origin_lng double precision,
  ADD COLUMN IF NOT EXISTS preferred_route_dest_lat double precision,
  ADD COLUMN IF NOT EXISTS preferred_route_dest_lng double precision,
  ADD COLUMN IF NOT EXISTS preferred_route_saved_at timestamptz;

CREATE OR REPLACE FUNCTION public.cleaner_city_set_preferred_route(
  p_polyline text,
  p_distance_meters integer,
  p_duration_seconds integer,
  p_summary text,
  p_origin_lat double precision,
  p_origin_lng double precision,
  p_dest_lat double precision,
  p_dest_lng double precision
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
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NULLIF(trim(COALESCE(p_polyline, '')), '') IS NULL THEN
    RAISE EXCEPTION 'route polyline is required';
  END IF;
  IF p_origin_lat IS NULL OR p_origin_lng IS NULL OR p_dest_lat IS NULL OR p_dest_lng IS NULL THEN
    RAISE EXCEPTION 'origin and destination coords are required';
  END IF;

  UPDATE public.commute_profiles
  SET
    preferred_route_polyline = trim(p_polyline),
    preferred_route_distance_meters = p_distance_meters,
    preferred_route_duration_seconds = p_duration_seconds,
    preferred_route_summary = NULLIF(trim(COALESCE(p_summary, '')), ''),
    preferred_route_origin_lat = p_origin_lat,
    preferred_route_origin_lng = p_origin_lng,
    preferred_route_dest_lat = p_dest_lat,
    preferred_route_dest_lng = p_dest_lng,
    preferred_route_saved_at = now(),
    updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required - complete Cleaner City set up first';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_preferred_route(
  text, integer, integer, text, double precision, double precision, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_preferred_route(
  text, integer, integer, text, double precision, double precision, double precision, double precision
) TO authenticated;
