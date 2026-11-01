-- A Cleaner City Unit 9: live tracking (active rides only) + SOS / incidents + trip share.
-- Privacy: no live location outside participants (or valid share token).

CREATE TABLE IF NOT EXISTS public.ride_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_meters double precision,
  heading double precision,
  speed_mps double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_locations_ride_recorded
  ON public.ride_locations (ride_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_ride_locations_user_recent
  ON public.ride_locations (user_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.ride_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  incident_type text NOT NULL
    CHECK (incident_type IN ('sos', 'unsafe_driving', 'harassment', 'accident', 'no_show', 'other')),
  severity text NOT NULL DEFAULT 'high'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  note text,
  latitude double precision,
  longitude double precision,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  admin_notes text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_incidents_status
  ON public.ride_incidents (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ride_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_share_tokens_token
  ON public.ride_share_tokens (token)
  WHERE revoked_at IS NULL;

ALTER TABLE public.ride_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_share_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.cleaner_city_is_ride_participant(p_ride_id uuid, p_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = p_ride_id
      AND (r.host_user_id = p_uid OR r.guest_user_id = p_uid)
  );
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_is_ride_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_is_ride_participant(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS ride_locations_select ON public.ride_locations;
CREATE POLICY ride_locations_select ON public.ride_locations
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.cleaner_city_is_ride_participant(ride_id, auth.uid())
  );

DROP POLICY IF EXISTS ride_locations_insert ON public.ride_locations;
CREATE POLICY ride_locations_insert ON public.ride_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.cleaner_city_is_ride_participant(ride_id, auth.uid())
  );

DROP POLICY IF EXISTS ride_incidents_select ON public.ride_incidents;
CREATE POLICY ride_incidents_select ON public.ride_incidents
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR reporter_user_id = auth.uid()
    OR public.cleaner_city_is_ride_participant(ride_id, auth.uid())
  );

DROP POLICY IF EXISTS ride_incidents_insert ON public.ride_incidents;
CREATE POLICY ride_incidents_insert ON public.ride_incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_user_id = auth.uid()
    AND public.cleaner_city_is_ride_participant(ride_id, auth.uid())
  );

DROP POLICY IF EXISTS ride_share_tokens_select ON public.ride_share_tokens;
CREATE POLICY ride_share_tokens_select ON public.ride_share_tokens
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR public.cleaner_city_is_ride_participant(ride_id, auth.uid())
  );

-- Upsert/append location only while ride is active (pickup_pending or started).
CREATE OR REPLACE FUNCTION public.cleaner_city_upsert_ride_location(
  p_ride_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision DEFAULT NULL,
  p_heading double precision DEFAULT NULL,
  p_speed_mps double precision DEFAULT NULL
)
RETURNS public.ride_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_recent timestamptz;
  v_row public.ride_locations;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'latitude and longitude required';
  END IF;
  IF p_latitude < -90 OR p_latitude > 90 OR p_longitude < -180 OR p_longitude > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('pickup_pending', 'started') THEN
    RAISE EXCEPTION 'Live location only during active ride';
  END IF;

  -- Rate limit: one write per user/ride every 3 seconds (scalable under burst)
  SELECT max(recorded_at) INTO v_recent
  FROM public.ride_locations
  WHERE ride_id = p_ride_id AND user_id = v_uid;

  IF v_recent IS NOT NULL AND v_recent > now() - interval '3 seconds' THEN
    SELECT * INTO v_row
    FROM public.ride_locations
    WHERE ride_id = p_ride_id AND user_id = v_uid
    ORDER BY recorded_at DESC
    LIMIT 1;
    RETURN v_row;
  END IF;

  INSERT INTO public.ride_locations (
    ride_id, society_id, user_id, latitude, longitude,
    accuracy_meters, heading, speed_mps, recorded_at
  )
  VALUES (
    p_ride_id, v_ride.society_id, v_uid, p_latitude, p_longitude,
    p_accuracy_meters, p_heading, p_speed_mps, now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_upsert_ride_location(
  uuid, double precision, double precision, double precision, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_upsert_ride_location(
  uuid, double precision, double precision, double precision, double precision, double precision
) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_latest_ride_locations(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF NOT public.is_admin(v_uid)
     AND v_ride.host_user_id <> v_uid
     AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb)
    FROM (
      SELECT DISTINCT ON (rl.user_id)
        rl.user_id,
        rl.latitude,
        rl.longitude,
        rl.accuracy_meters,
        rl.heading,
        rl.speed_mps,
        rl.recorded_at,
        CASE WHEN rl.user_id = v_ride.host_user_id THEN 'host' ELSE 'guest' END AS role
      FROM public.ride_locations rl
      WHERE rl.ride_id = p_ride_id
        AND rl.recorded_at > now() - interval '30 minutes'
      ORDER BY rl.user_id, rl.recorded_at DESC
    ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_latest_ride_locations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_latest_ride_locations(uuid) TO authenticated;

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
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
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

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, society_id, idempotency_key
  )
  VALUES (
    v_other,
    CASE WHEN p_incident_type = 'sos' THEN 'SOS on your commute' ELSE 'Safety report on ride' END,
    'A participant reported a safety issue. Open the ride for details.',
    'cleaner_city_safety',
    '/cleaner-city/ride/' || p_ride_id::text,
    jsonb_build_object('ride_id', p_ride_id, 'incident_id', v_row.id, 'type', p_incident_type),
    v_ride.society_id,
    'cc_safety_' || v_row.id::text
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_report_incident(
  uuid, text, text, double precision, double precision, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_report_incident(
  uuid, text, text, double precision, double precision, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_create_share_token(p_ride_id uuid)
RETURNS public.ride_share_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_row public.ride_share_tokens;
  v_token text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending', 'started') THEN
    RAISE EXCEPTION 'Share only available for active/confirmed rides';
  END IF;

  -- Revoke prior tokens for this ride+creator
  UPDATE public.ride_share_tokens
  SET revoked_at = now()
  WHERE ride_id = p_ride_id AND created_by = v_uid AND revoked_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(18), 'hex');

  INSERT INTO public.ride_share_tokens (
    ride_id, society_id, created_by, token, expires_at
  )
  VALUES (
    p_ride_id, v_ride.society_id, v_uid, v_token, now() + interval '6 hours'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_create_share_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_create_share_token(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_view_shared_ride(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share public.ride_share_tokens;
  v_ride public.rides;
  v_locs jsonb;
BEGIN
  SELECT * INTO v_share
  FROM public.ride_share_tokens
  WHERE token = trim(p_token)
    AND revoked_at IS NULL
    AND expires_at > now();

  IF v_share.id IS NULL THEN
    RAISE EXCEPTION 'Share link invalid or expired';
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = v_share.ride_id;
  IF v_ride.id IS NULL OR v_ride.status NOT IN ('confirmed', 'pickup_pending', 'started') THEN
    RAISE EXCEPTION 'Ride is no longer shareable';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_locs
  FROM (
    SELECT DISTINCT ON (rl.user_id)
      rl.latitude, rl.longitude, rl.recorded_at,
      CASE WHEN rl.user_id = v_ride.host_user_id THEN 'host' ELSE 'guest' END AS role
    FROM public.ride_locations rl
    WHERE rl.ride_id = v_ride.id
      AND rl.recorded_at > now() - interval '30 minutes'
    ORDER BY rl.user_id, rl.recorded_at DESC
  ) x;

  RETURN jsonb_build_object(
    'ride_id', v_ride.id,
    'status', v_ride.status,
    'travel_date', v_ride.travel_date,
    'locations', v_locs,
    'expires_at', v_share.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_view_shared_ride(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_view_shared_ride(text) TO authenticated, anon;

COMMENT ON FUNCTION public.cleaner_city_upsert_ride_location IS
  'Unit 9: participant live location during active ride only; 3s rate limit.';
COMMENT ON FUNCTION public.cleaner_city_report_incident IS
  'Unit 9: SOS/safety report; SOS flips ride to safety_incident.';
