-- A Cleaner City Units 10-12 completion:
-- 10 reputation + blocks
-- 11 ride notification helpers wired into booking/lifecycle
-- 12 admin stats, incident resolve, settings, rate hardening

-- ---------------------------------------------------------------------------
-- Unit 10: blocks + reputation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.commute_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  blocker_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_blocks_not_self CHECK (blocker_user_id <> blocked_user_id),
  CONSTRAINT commute_blocks_unique UNIQUE (blocker_user_id, blocked_user_id)
);

CREATE INDEX IF NOT EXISTS idx_commute_blocks_blocked
  ON public.commute_blocks (blocked_user_id);

ALTER TABLE public.commute_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_blocks_select ON public.commute_blocks;
CREATE POLICY commute_blocks_select ON public.commute_blocks
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR blocker_user_id = auth.uid()
  );

DROP POLICY IF EXISTS commute_blocks_write ON public.commute_blocks;
CREATE POLICY commute_blocks_write ON public.commute_blocks
  FOR ALL TO authenticated
  USING (blocker_user_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (blocker_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.cleaner_city_block_user(
  p_blocked_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.commute_blocks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.commute_blocks;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_blocked_user_id IS NULL OR p_blocked_user_id = v_uid THEN
    RAISE EXCEPTION 'Invalid blocked user';
  END IF;
  v_society := public.get_user_society_id(v_uid);

  INSERT INTO public.commute_blocks (society_id, blocker_user_id, blocked_user_id, reason)
  VALUES (
    v_society, v_uid, p_blocked_user_id,
    NULLIF(trim(COALESCE(p_reason, '')), '')
  )
  ON CONFLICT (blocker_user_id, blocked_user_id) DO UPDATE SET
    reason = COALESCE(EXCLUDED.reason, commute_blocks.reason)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_block_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_block_user(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_unblock_user(p_blocked_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  DELETE FROM public.commute_blocks
  WHERE blocker_user_id = v_uid AND blocked_user_id = p_blocked_user_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_unblock_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_unblock_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_reputation(p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_avg numeric;
  v_count integer;
  v_completed integer;
  v_incidents integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  -- Self or admin only for full reputation; others get aggregate only if they share a ride history
  IF v_uid IS DISTINCT FROM p_user_id AND NOT public.is_admin(v_uid) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.status = 'completed'
        AND (
          (r.host_user_id = v_uid AND r.guest_user_id = p_user_id)
          OR (r.guest_user_id = v_uid AND r.host_user_id = p_user_id)
        )
    ) THEN
      -- Limited public aggregate for matching cards
      NULL;
    END IF;
  END IF;

  SELECT round(avg(stars)::numeric, 2), count(*)
  INTO v_avg, v_count
  FROM public.ride_ratings
  WHERE rated_user_id = p_user_id;

  SELECT count(*) INTO v_completed
  FROM public.rides
  WHERE status = 'completed'
    AND (host_user_id = p_user_id OR guest_user_id = p_user_id);

  SELECT count(*) INTO v_incidents
  FROM public.ride_incidents
  WHERE reporter_user_id <> p_user_id
    AND ride_id IN (
      SELECT id FROM public.rides
      WHERE host_user_id = p_user_id OR guest_user_id = p_user_id
    )
    AND status IN ('open', 'acknowledged', 'resolved');

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'avg_stars', v_avg,
    'rating_count', COALESCE(v_count, 0),
    'completed_rides', COALESCE(v_completed, 0),
    'incident_mentions', COALESCE(v_incidents, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_reputation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_reputation(uuid) TO authenticated;

-- Exclude blocked hosts from matches
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
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'date is required';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;

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
  v_depart := p_depart_time;
  IF v_depart IS NULL THEN
    v_depart := ((public.cleaner_city_effective_schedule(v_uid, p_date))->>'depart_time')::time;
  END IF;

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
      AND p.society_id = ANY (v_allowed)
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
          IF (
            100.0 * (1.0 - least(1.0,
              (v_detour->>'extra_meters')::double precision /
              NULLIF((v_detour->>'direct_meters')::double precision, 0)
            ))
          ) < v_min_overlap THEN
            v_reasons := array_append(v_reasons, 'overlap_soft_below_target');
            v_score := v_score - 5;
          ELSE
            v_reasons := array_append(v_reasons, 'overlap_proxy_ok');
            v_score := v_score + 10;
          END IF;
        END IF;
      END IF;
    END IF;

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
      'has_route', r.route_polyline IS NOT NULL,
      'estimated_detour_minutes', v_detour_min,
      'pickup_deviation_meters', v_pickup_dev_m,
      'destination_deviation_meters', v_dest_dev_m,
      'host_avg_stars', v_rep->>'avg_stars',
      'host_rating_count', v_rep->>'rating_count',
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
      'min_route_overlap_pct', v_min_overlap
    ),
    'matches', (
      SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'score')::numeric DESC), '[]'::jsonb)
      FROM jsonb_array_elements(v_results) elem
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Unit 11: notification helper + wire into request/respond/cancel/complete
-- ---------------------------------------------------------------------------

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
    '/cleaner-city/ride/' || p_ride_id::text,
    jsonb_build_object('ride_id', p_ride_id, 'type', p_type),
    p_society_id,
    p_idempotency_key
  )
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_enqueue_notify(
  uuid, text, text, text, uuid, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_enqueue_notify(
  uuid, text, text, text, uuid, uuid, text
) TO service_role;

-- Patch request_ride to notify host
CREATE OR REPLACE FUNCTION public.cleaner_city_request_ride(
  p_publication_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pub public.commute_publications;
  v_row public.rides;
  v_recent integer;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  -- Rate limit requests
  SELECT count(*) INTO v_recent
  FROM public.rides
  WHERE guest_user_id = v_uid AND created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Rate limit: too many ride requests';
  END IF;

  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id FOR UPDATE;
  IF v_pub.id IS NULL THEN RAISE EXCEPTION 'Publication not found'; END IF;
  IF v_pub.status <> 'published' THEN RAISE EXCEPTION 'Ride is not open for requests'; END IF;
  IF v_pub.host_user_id = v_uid THEN RAISE EXCEPTION 'Cannot request your own ride'; END IF;
  IF v_pub.seats_available < 1 THEN RAISE EXCEPTION 'No seats available'; END IF;
  IF NOT (v_pub.society_id = ANY (public.cleaner_city_allowed_society_ids(v_uid))) THEN
    RAISE EXCEPTION 'Publication outside your match scope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commute_blocks b
    WHERE (b.blocker_user_id = v_uid AND b.blocked_user_id = v_pub.host_user_id)
       OR (b.blocker_user_id = v_pub.host_user_id AND b.blocked_user_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Cannot request this host';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.publication_id = p_publication_id AND r.guest_user_id = v_uid
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an open request for this ride';
  END IF;

  UPDATE public.commute_publications
  SET seats_available = seats_available - 1,
      status = CASE WHEN seats_available - 1 <= 0 THEN 'full' ELSE status END,
      updated_at = now()
  WHERE id = p_publication_id;

  INSERT INTO public.rides (
    society_id, publication_id, host_user_id, guest_user_id, travel_date, status, updated_at
  ) VALUES (
    v_pub.society_id, v_pub.id, v_pub.host_user_id, v_uid, v_pub.travel_date, 'requested', now()
  ) RETURNING * INTO v_row;

  PERFORM public.cleaner_city_append_ride_event(
    v_row.id, v_row.society_id, v_uid, 'requested', NULL, 'requested',
    jsonb_build_object('publication_id', p_publication_id, 'note', NULLIF(trim(COALESCE(p_note, '')), ''))
  );

  PERFORM public.cleaner_city_enqueue_notify(
    v_pub.host_user_id,
    'New commute request',
    'A neighbour asked for a seat on your published ride.',
    'cleaner_city_ride_request',
    v_row.id, v_row.society_id,
    'cc_req_' || v_row.id::text
  );

  RETURN v_row;
END;
$$;

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
  v_from text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid THEN RAISE EXCEPTION 'Only the host can respond'; END IF;
  IF v_ride.status <> 'requested' THEN RAISE EXCEPTION 'Ride is not awaiting a response'; END IF;
  v_from := v_ride.status;

  IF COALESCE(p_accept, false) THEN
    UPDATE public.rides SET status = 'confirmed', updated_at = now()
    WHERE id = p_ride_id RETURNING * INTO v_ride;
    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'confirmed', v_from, 'confirmed', '{}'::jsonb
    );
    PERFORM public.cleaner_city_enqueue_notify(
      v_ride.guest_user_id, 'Seat confirmed', 'Your commute request was accepted.',
      'cleaner_city_ride_update', v_ride.id, v_ride.society_id, 'cc_acc_' || v_ride.id::text
    );
  ELSE
    UPDATE public.rides SET status = 'rejected', updated_at = now()
    WHERE id = p_ride_id RETURNING * INTO v_ride;
    SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id FOR UPDATE;
    IF v_pub.id IS NOT NULL AND v_pub.status IN ('published', 'full') THEN
      UPDATE public.commute_publications
      SET seats_available = least(seats_total, seats_available + 1),
          status = 'published', updated_at = now()
      WHERE id = v_pub.id;
    END IF;
    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'rejected', v_from, 'rejected', '{}'::jsonb
    );
    PERFORM public.cleaner_city_enqueue_notify(
      v_ride.guest_user_id, 'Request declined', 'The host could not take this request.',
      'cleaner_city_ride_update', v_ride.id, v_ride.society_id, 'cc_rej_' || v_ride.id::text
    );
  END IF;
  RETURN v_ride;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_complete_ride(p_ride_id uuid)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_from text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid THEN RAISE EXCEPTION 'Only the host can complete the ride'; END IF;
  IF v_ride.status <> 'started' THEN RAISE EXCEPTION 'Ride must be started before completion'; END IF;
  v_from := v_ride.status;
  UPDATE public.rides
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_ride_id RETURNING * INTO v_ride;
  UPDATE public.commute_publications
  SET status = 'completed', updated_at = now()
  WHERE id = v_ride.publication_id AND status IN ('published', 'full');
  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'completed', v_from, 'completed', '{}'::jsonb
  );
  PERFORM public.cleaner_city_enqueue_notify(
    v_ride.guest_user_id, 'Ride completed', 'Rate your commute and settle fuel share if needed.',
    'cleaner_city_ride_update', v_ride.id, v_ride.society_id, 'cc_done_' || v_ride.id::text
  );
  RETURN v_ride;
END;
$$;

-- ---------------------------------------------------------------------------
-- Unit 12: admin stats, incident resolve, settings
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_stats(p_society_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN jsonb_build_object(
    'profiles', (SELECT count(*) FROM public.commute_profiles WHERE deleted_at IS NULL
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'verified', (SELECT count(*) FROM public.work_verifications WHERE status = 'verified'),
    'active_vehicles', (SELECT count(*) FROM public.vehicles WHERE is_active = true
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'publications_open', (SELECT count(*) FROM public.commute_publications
      WHERE status IN ('published', 'full') AND travel_date >= CURRENT_DATE
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'rides_today', (SELECT count(*) FROM public.rides WHERE travel_date = CURRENT_DATE
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'rides_active', (SELECT count(*) FROM public.rides
      WHERE status IN ('requested', 'confirmed', 'pickup_pending', 'started')
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'incidents_open', (SELECT count(*) FROM public.ride_incidents WHERE status = 'open'
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'cost_shares_proposed', (SELECT count(*) FROM public.ride_cost_shares WHERE status = 'proposed'
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'domains_pending', (SELECT count(*) FROM public.company_domains WHERE status = 'pending'),
    'avg_rating', (SELECT round(avg(stars)::numeric, 2) FROM public.ride_ratings)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_stats(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_resolve_incident(
  p_incident_id uuid,
  p_status text,
  p_admin_notes text DEFAULT NULL
)
RETURNS public.ride_incidents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ride_incidents;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('acknowledged', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE public.ride_incidents
  SET
    status = p_status,
    admin_notes = NULLIF(trim(COALESCE(p_admin_notes, '')), ''),
    resolved_by = CASE WHEN p_status IN ('resolved', 'dismissed') THEN v_uid ELSE resolved_by END,
    resolved_at = CASE WHEN p_status IN ('resolved', 'dismissed') THEN now() ELSE resolved_at END,
    updated_at = now()
  WHERE id = p_incident_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Incident not found';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_resolve_incident(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_resolve_incident(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_set_match_scope(
  p_society_id uuid,
  p_match_scope text,
  p_thresholds jsonb DEFAULT NULL
)
RETURNS public.cleaner_city_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.cleaner_city_settings;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_match_scope IS NULL OR p_match_scope NOT IN ('same_society', 'neighbours', 'city') THEN
    RAISE EXCEPTION 'match_scope must be same_society, neighbours, or city';
  END IF;

  INSERT INTO public.cleaner_city_settings (society_id, match_scope, thresholds, updated_at)
  VALUES (
    p_society_id,
    p_match_scope,
    COALESCE(p_thresholds, jsonb_build_object(
      'pickup_deviation_km', 1.5,
      'destination_deviation_km', 2.0,
      'departure_difference_minutes', 30,
      'max_detour_minutes', 15,
      'min_seats', 1,
      'min_route_overlap_pct', 65
    )),
    now()
  )
  ON CONFLICT (society_id) DO UPDATE SET
    match_scope = EXCLUDED.match_scope,
    thresholds = COALESCE(p_thresholds, cleaner_city_settings.thresholds),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_set_match_scope(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_set_match_scope(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_admin_stats IS
  'Unit 12: pilot ops dashboard aggregates.';
COMMENT ON FUNCTION public.cleaner_city_block_user IS
  'Unit 10: mutual block prevents matching and requests.';
