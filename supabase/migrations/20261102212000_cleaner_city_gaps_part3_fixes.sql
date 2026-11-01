-- Fixes: service-role schedule reads, notify path without ride_id,
-- unambiguous request_ride signature.

CREATE OR REPLACE FUNCTION public.cleaner_city_effective_schedule(
  p_user_id uuid DEFAULT auth.uid(),
  p_date date DEFAULT (timezone('Asia/Kolkata', now()))::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_profile public.commute_profiles;
  v_override public.commute_overrides;
  v_template public.commute_templates;
  v_dow smallint;
  v_tz text;
  v_service boolean := (v_caller IS NULL);
BEGIN
  IF p_user_id IS NULL THEN
    IF v_caller IS NULL THEN
      RAISE EXCEPTION 'user_id required';
    END IF;
    p_user_id := v_caller;
  END IF;

  IF NOT v_service THEN
    IF p_user_id <> v_caller
       AND NOT public.is_admin(v_caller)
       AND NOT public.is_society_admin(v_caller, public.get_user_society_id(p_user_id)) THEN
      RAISE EXCEPTION 'Not allowed to read this schedule';
    END IF;
  END IF;

  SELECT * INTO v_profile
  FROM public.commute_profiles
  WHERE user_id = p_user_id AND deleted_at IS NULL;

  IF v_profile.id IS NULL THEN
    RETURN jsonb_build_object(
      'date', p_date, 'source', 'none', 'is_working', false, 'is_paused', false,
      'timezone', 'Asia/Kolkata'
    );
  END IF;

  v_tz := COALESCE(v_profile.timezone, 'Asia/Kolkata');

  IF v_profile.is_paused THEN
    RETURN jsonb_build_object(
      'date', p_date, 'source', 'paused', 'is_working', false, 'is_paused', true,
      'timezone', v_tz, 'role', v_profile.role,
      'autopilot_enabled', v_profile.autopilot_enabled,
      'autopilot_confirm_mode', v_profile.autopilot_confirm_mode
    );
  END IF;

  SELECT * INTO v_override
  FROM public.commute_overrides
  WHERE user_id = p_user_id AND override_date = p_date;

  IF v_override.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'date', p_date, 'source', 'override', 'is_working', v_override.is_working,
      'is_paused', false, 'timezone', v_tz,
      'depart_time', v_override.depart_time, 'return_time', v_override.return_time,
      'pickup_label', v_override.pickup_label,
      'pickup_latitude', v_override.pickup_latitude,
      'pickup_longitude', v_override.pickup_longitude,
      'override_kind', v_override.override_kind, 'note', v_override.note,
      'role', v_profile.role,
      'autopilot_enabled', v_profile.autopilot_enabled,
      'autopilot_confirm_mode', v_profile.autopilot_confirm_mode
    );
  END IF;

  v_dow := EXTRACT(DOW FROM p_date)::smallint;
  SELECT * INTO v_template
  FROM public.commute_templates
  WHERE user_id = p_user_id AND weekday = v_dow;

  IF v_template.id IS NULL THEN
    RETURN jsonb_build_object(
      'date', p_date, 'source', 'none', 'is_working', false, 'is_paused', false,
      'timezone', v_tz, 'weekday', v_dow, 'role', v_profile.role,
      'autopilot_enabled', v_profile.autopilot_enabled,
      'autopilot_confirm_mode', v_profile.autopilot_confirm_mode
    );
  END IF;

  RETURN jsonb_build_object(
    'date', p_date, 'source', 'template', 'is_working', v_template.is_working,
    'is_paused', false, 'timezone', v_tz, 'weekday', v_dow,
    'depart_time', v_template.depart_time, 'return_time', v_template.return_time,
    'pickup_label', v_template.pickup_label,
    'pickup_latitude', v_template.pickup_latitude,
    'pickup_longitude', v_template.pickup_longitude,
    'role', v_profile.role,
    'autopilot_enabled', v_profile.autopilot_enabled,
    'autopilot_confirm_mode', v_profile.autopilot_confirm_mode
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_enqueue_notify(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_type text,
  p_ride_id uuid,
  p_society_id uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, society_id, idempotency_key
  )
  VALUES (
    p_user_id,
    p_title,
    p_body,
    p_type,
    CASE
      WHEN p_ride_id IS NOT NULL THEN '/cleaner-city/ride/' || p_ride_id::text
      ELSE '/cleaner-city'
    END,
    jsonb_build_object('ride_id', p_ride_id, 'type', p_type),
    p_society_id,
    p_idempotency_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END;
$$;

-- Prefer single 6-arg request_ride; drop 2-arg to avoid ambiguity
DROP FUNCTION IF EXISTS public.cleaner_city_request_ride(uuid, text);

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

REVOKE ALL ON FUNCTION public.cleaner_city_request_ride(
  uuid, text, double precision, double precision, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_request_ride(
  uuid, text, double precision, double precision, double precision, double precision
) TO authenticated;

-- List blocks for unblock UI
CREATE OR REPLACE FUNCTION public.cleaner_city_list_blocks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'blocked_user_id', b.blocked_user_id,
      'reason', b.reason,
      'created_at', b.created_at
    ) ORDER BY b.created_at DESC)
    FROM public.commute_blocks b
    WHERE b.blocker_user_id = auth.uid()
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_list_blocks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_list_blocks() TO authenticated;
