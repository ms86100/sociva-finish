-- Five remaining Cleaner City gaps.
-- Sort key is after 20261102233000 so the guest booking lock is already in place.
-- Not applied to production by this change.
-- Does not seed meetup coordinates and does not change publication or circle SELECT policies.
-- Booking still takes the guest/date/direction advisory lock from B3. This file creates that
-- helper if the B3 migration has not been applied yet.

DROP FUNCTION IF EXISTS public.cleaner_city_lock_guest_booking(uuid, date, text);
CREATE OR REPLACE FUNCTION public.cleaner_city_lock_guest_booking(
  p_guest uuid,
  p_travel_date date,
  p_direction text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_key bigint;
BEGIN
  IF p_guest IS NULL OR p_travel_date IS NULL OR p_direction IS NULL THEN
    RAISE EXCEPTION 'Booking lock requires guest, date, and direction';
  END IF;
  IF p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'invalid direction';
  END IF;
  v_key := hashtextextended(
    'cc-guest-booking|' || p_guest::text || '|' || p_travel_date::text || '|' || p_direction,
    0
  );
  PERFORM pg_advisory_xact_lock(v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_lock_guest_booking(uuid, date, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cleaner_city_lock_guest_booking(uuid, date, text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cleaner_city_lock_guest_booking(uuid, date, text) FROM authenticated';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.cleaner_city_lock_guest_booking(uuid, date, text) TO service_role;

ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS circle_only_matching boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS circle_visibility text NOT NULL DEFAULT 'members',
  ADD COLUMN IF NOT EXISTS show_on_circle_board boolean NOT NULL DEFAULT false;

ALTER TABLE public.commute_profiles
  DROP CONSTRAINT IF EXISTS commute_profiles_circle_visibility_chk;
ALTER TABLE public.commute_profiles
  ADD CONSTRAINT commute_profiles_circle_visibility_chk
  CHECK (circle_visibility IN ('members', 'private'));

ALTER TABLE public.commute_emergency_contacts
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_method text,
  ADD COLUMN IF NOT EXISTS verify_salt text,
  ADD COLUMN IF NOT EXISTS verify_hash text,
  ADD COLUMN IF NOT EXISTS verify_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.commute_circle_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.commute_circles(id) ON DELETE CASCADE,
  inviter_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invitee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_circle_invites_not_self CHECK (inviter_user_id <> invitee_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commute_circle_invites_pending
  ON public.commute_circle_invites (circle_id, invitee_user_id)
  WHERE status = 'pending';

ALTER TABLE public.commute_circle_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_circle_invites_read ON public.commute_circle_invites;
CREATE POLICY commute_circle_invites_read ON public.commute_circle_invites
  FOR SELECT TO authenticated
  USING (
    invitee_user_id = auth.uid()
    OR inviter_user_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.commute_seat_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.commute_publications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commute_seat_offers_open_pub
  ON public.commute_seat_offers (publication_id)
  WHERE status = 'open';

ALTER TABLE public.commute_seat_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_seat_offers_read_own ON public.commute_seat_offers;
CREATE POLICY commute_seat_offers_read_own ON public.commute_seat_offers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.cleaner_city_outbound_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ride_id uuid,
  incident_id uuid,
  channel text NOT NULL CHECK (channel IN ('sms', 'call')),
  destination_phone text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cleaner_city_outbound_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cleaner_city_outbound_alerts_none ON public.cleaner_city_outbound_alerts;
CREATE POLICY cleaner_city_outbound_alerts_none ON public.cleaner_city_outbound_alerts
  FOR SELECT TO authenticated
  USING (false);

-- Phone numbers stay off the client. Status only.
CREATE OR REPLACE FUNCTION public.cleaner_city_outbound_alert_status(p_alert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.cleaner_city_outbound_alerts;
BEGIN
  SELECT * INTO v_row FROM public.cleaner_city_outbound_alerts WHERE id = p_alert_id;
  IF v_row.id IS NULL OR v_row.user_id <> v_uid THEN
    RAISE EXCEPTION 'Alert not found';
  END IF;
  RETURN jsonb_build_object(
    'id', v_row.id,
    'channel', v_row.channel,
    'status', v_row.status,
    'attempts', v_row.attempts,
    'last_error', v_row.last_error
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_outbound_alert_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_outbound_alert_status(uuid) TO authenticated;

-- plpgsql treats << as a label, so the shift lives in a SQL helper.
CREATE OR REPLACE FUNCTION public.cleaner_city_shl(p_value bigint, p_bits integer)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$ SELECT p_value << p_bits $$;

-- Saved driving polyline overlap. Returns null when the polyline cannot be read.
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
  v_best1 double precision := 1e12;
  v_best2 double precision := 1e12;
  v_d double precision;
  v_plat double precision;
  v_plng double precision;
  v_ch text;
BEGIN
  IF p_polyline IS NULL OR length(p_polyline) < 2 THEN
    RETURN NULL;
  END IF;
  IF p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN
    RETURN NULL;
  END IF;
  v_len := length(p_polyline);
  WHILE v_i <= v_len AND v_points < 80 LOOP
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
    v_d := public.cleaner_city_haversine_meters(p_lat1, p_lng1, v_plat, v_plng);
    IF v_d < v_best1 THEN v_best1 := v_d; END IF;
    v_d := public.cleaner_city_haversine_meters(p_lat2, p_lng2, v_plat, v_plng);
    IF v_d < v_best2 THEN v_best2 := v_d; END IF;
    v_points := v_points + 1;
  END LOOP;

  IF v_points = 0 THEN
    RETURN NULL;
  END IF;
  IF v_best1 > 800 AND v_best2 > 800 THEN
    RETURN 0;
  END IF;
  RETURN round(GREATEST(0, 100.0 * (1.0 - LEAST(1.0, ((v_best1 + v_best2) / 2.0) / 800.0)))::numeric, 1);
END;
$$;

-- ---------------------------------------------------------------------------
-- Autopilot: repeat, WFH, refresh drafts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_repeat_last_commute()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.commute_profiles;
  v_last public.commute_publications;
  v_ride public.rides;
  v_pub public.commute_publications;
  v_date date := (timezone('Asia/Kolkata', now()))::date + 1;
  v_existing uuid;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_profile FROM public.commute_profiles
  WHERE user_id = v_uid AND deleted_at IS NULL;
  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;

  IF v_profile.role IN ('host', 'both') THEN
    SELECT * INTO v_last
    FROM public.commute_publications
    WHERE host_user_id = v_uid
      AND status IN ('draft', 'published', 'full', 'completed')
    ORDER BY travel_date DESC, created_at DESC
    LIMIT 1;
    IF v_last.id IS NULL THEN
      RAISE EXCEPTION 'No previous commute to repeat';
    END IF;
    SELECT id INTO v_existing
    FROM public.commute_publications
    WHERE host_user_id = v_uid
      AND travel_date = v_date
      AND direction = v_last.direction
      AND status IN ('draft', 'published', 'full', 'cancelled');
    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object('action', 'exists', 'publication_id', v_existing, 'travel_date', v_date);
    END IF;
    INSERT INTO public.commute_publications (
      host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
      seats_available, seats_total, status,
      origin_latitude, origin_longitude, destination_latitude, destination_longitude,
      origin_label, destination_label, route_polyline, updated_at
    ) VALUES (
      v_uid, v_last.society_id, v_last.vehicle_id, v_date, v_last.direction, v_last.depart_time,
      v_last.seats_total, v_last.seats_total, 'draft',
      v_last.origin_latitude, v_last.origin_longitude, v_last.destination_latitude, v_last.destination_longitude,
      v_last.origin_label, v_last.destination_label, v_last.route_polyline, now()
    )
    RETURNING * INTO v_pub;
    RETURN jsonb_build_object('action', 'draft', 'publication_id', v_pub.id, 'travel_date', v_date, 'direction', v_pub.direction);
  END IF;

  SELECT * INTO v_ride
  FROM public.rides
  WHERE guest_user_id = v_uid
  ORDER BY travel_date DESC, created_at DESC
  LIMIT 1;
  IF v_ride.id IS NULL OR v_ride.publication_id IS NULL THEN
    RAISE EXCEPTION 'No previous ride to repeat';
  END IF;
  SELECT * INTO v_last FROM public.commute_publications WHERE id = v_ride.publication_id;
  SELECT id INTO v_existing
  FROM public.commute_publications
  WHERE host_user_id = v_last.host_user_id
    AND travel_date = v_date
    AND direction = v_last.direction
    AND status = 'published'
    AND seats_available > 0;
  IF v_existing IS NULL THEN
    RAISE EXCEPTION 'That host has no open seat tomorrow yet';
  END IF;
  RETURN jsonb_build_object('action', 'request', 'publication_id', v_existing, 'travel_date', v_date, 'direction', v_last.direction);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_repeat_last_commute() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_repeat_last_commute() TO authenticated;

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
    AND status = 'draft';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object('date', p_date, 'is_working', false, 'drafts_cancelled', v_cancelled);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_mark_wfh(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_mark_wfh(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_refresh_open_drafts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer := 0;
  r record;
  v_sched jsonb;
  v_office record;
  v_today date := (timezone('Asia/Kolkata', now()))::date;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  FOR r IN
    SELECT * FROM public.commute_publications
    WHERE host_user_id = v_uid
      AND status = 'draft'
      AND travel_date >= v_today
  LOOP
    v_sched := public.cleaner_city_effective_schedule(v_uid, r.travel_date);
    IF NOT COALESCE((v_sched->>'is_working')::boolean, false) THEN
      UPDATE public.commute_publications
      SET status = 'cancelled', updated_at = now()
      WHERE id = r.id AND status = 'draft';
      v_count := v_count + 1;
      CONTINUE;
    END IF;
    SELECT * INTO v_office
    FROM public.office_locations o
    WHERE o.user_id = v_uid
    ORDER BY o.is_primary DESC, o.updated_at DESC
    LIMIT 1;
    UPDATE public.commute_publications
    SET depart_time = COALESCE((v_sched->>'depart_time')::time, depart_time),
        origin_latitude = COALESCE((v_sched->>'pickup_latitude')::double precision, origin_latitude),
        origin_longitude = COALESCE((v_sched->>'pickup_longitude')::double precision, origin_longitude),
        origin_label = COALESCE(v_sched->>'pickup_label', origin_label),
        destination_latitude = COALESCE(v_office.latitude, destination_latitude),
        destination_longitude = COALESCE(v_office.longitude, destination_longitude),
        destination_label = COALESCE(v_office.label, destination_label),
        updated_at = now()
    WHERE id = r.id AND status = 'draft';
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_refresh_open_drafts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_refresh_open_drafts() TO authenticated;

-- ---------------------------------------------------------------------------
-- Seat offers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_expire_seat_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT * FROM public.commute_seat_offers
    WHERE status = 'open' AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.commute_seat_offers
    SET status = 'expired', updated_at = now()
    WHERE id = r.id AND status = 'open';
    PERFORM public.cleaner_city_notify_waitlist_for_publication(r.publication_id, false);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_expire_seat_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_expire_seat_offers() TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_notify_waitlist_for_publication(
  p_publication_id uuid,
  p_mark_matched boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub public.commute_publications;
  v_count integer := 0;
  w record;
  v_dist double precision;
  v_depart_gap double precision;
  v_offered boolean := false;
  v_title text;
  v_body text;
BEGIN
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id;
  IF v_pub.id IS NULL OR v_pub.status NOT IN ('published', 'full') THEN
    RETURN 0;
  END IF;
  IF v_pub.seats_available < 1 AND v_pub.status = 'full' THEN
    RETURN 0;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commute_seat_offers
    WHERE publication_id = p_publication_id AND status = 'open' AND expires_at > now()
  ) THEN
    v_offered := true;
  END IF;

  FOR w IN
    SELECT * FROM public.commute_waitlist
    WHERE status = 'open'
      AND travel_date = v_pub.travel_date
      AND direction = v_pub.direction
      AND user_id <> v_pub.host_user_id
    ORDER BY created_at
    LIMIT 40
  LOOP
    IF NOT (v_pub.society_id = ANY (public.cleaner_city_allowed_society_ids(w.user_id))) THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.commute_blocks b
      WHERE (b.blocker_user_id = w.user_id AND b.blocked_user_id = v_pub.host_user_id)
         OR (b.blocker_user_id = v_pub.host_user_id AND b.blocked_user_id = w.user_id)
    ) THEN
      CONTINUE;
    END IF;
    IF w.pickup_latitude IS NOT NULL AND v_pub.origin_latitude IS NOT NULL
       AND w.pickup_longitude IS NOT NULL AND v_pub.origin_longitude IS NOT NULL THEN
      v_dist := public.cleaner_city_haversine_meters(
        w.pickup_latitude, w.pickup_longitude, v_pub.origin_latitude, v_pub.origin_longitude
      );
      IF v_dist > 5000 THEN CONTINUE; END IF;
    END IF;
    IF w.dest_latitude IS NOT NULL AND v_pub.destination_latitude IS NOT NULL
       AND w.dest_longitude IS NOT NULL AND v_pub.destination_longitude IS NOT NULL THEN
      v_dist := public.cleaner_city_haversine_meters(
        w.dest_latitude, w.dest_longitude, v_pub.destination_latitude, v_pub.destination_longitude
      );
      IF v_dist > 5000 THEN CONTINUE; END IF;
    END IF;
    IF w.depart_time IS NOT NULL AND v_pub.depart_time IS NOT NULL THEN
      v_depart_gap := abs(EXTRACT(EPOCH FROM (w.depart_time - v_pub.depart_time)) / 60.0);
      IF v_depart_gap > 45 THEN CONTINUE; END IF;
    END IF;

    v_title := 'Seat opened on your corridor';
    v_body := 'A neighbour has an open seat for your waitlisted commute. This is not a reserved seat - open Find a ride to request.';
    IF NOT v_offered AND v_pub.seats_available >= 1 THEN
      INSERT INTO public.commute_seat_offers (publication_id, user_id, society_id, expires_at)
      VALUES (p_publication_id, w.user_id, w.society_id, now() + interval '10 minutes');
      v_offered := true;
      v_title := 'Seat held for you for 10 minutes';
      v_body := 'A neighbour has 1 open seat on your corridor. It is held for you for 10 minutes. Open Find a ride and request before it expires.';
    ELSIF v_offered THEN
      v_body := 'A seat opened on your corridor, and it is held for an earlier waitlist neighbour for up to 10 minutes.';
    END IF;

    PERFORM public.cleaner_city_enqueue_notify(
      w.user_id, v_title, v_body, 'cleaner_city_ride_update', NULL, w.society_id,
      'cc_waitlist_' || w.id::text || '_' || p_publication_id::text || '_' || CASE WHEN p_mark_matched THEN 'pub' ELSE 'seat' END
    );
    IF p_mark_matched THEN
      UPDATE public.commute_waitlist
      SET status = 'matched', matched_publication_id = p_publication_id, updated_at = now()
      WHERE id = w.id AND status = 'open';
    END IF;
    v_count := v_count + 1;
    IF v_count >= 20 THEN EXIT; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Dispute
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_dispute_ride(p_ride_id uuid, p_note text DEFAULT NULL)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('no_show', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Only a finished, cancelled, or no-show ride can be disputed';
  END IF;
  UPDATE public.rides
  SET status = 'disputed', updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;
  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'disputed', NULL, 'disputed',
    jsonb_build_object('note', NULLIF(trim(COALESCE(p_note, '')), ''))
  );
  PERFORM public.cleaner_city_enqueue_notify(
    CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END,
    'Ride disputed',
    'The other person opened a dispute on this commute. An admin can review it.',
    'cleaner_city_ride_update',
    v_ride.id,
    v_ride.society_id,
    'cc_dispute_' || v_ride.id::text
  );
  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_dispute_ride(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_dispute_ride(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Circles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_set_circle_prefs(
  p_circle_only boolean,
  p_visibility text,
  p_show_on_board boolean
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
      updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Commute profile required'; END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_circle_prefs(boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_circle_prefs(boolean, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_invite_to_circle(p_circle_id uuid, p_invitee uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_circle_invites;
  v_domain_a text;
  v_domain_b text;
  v_allowed boolean := false;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_invitee IS NULL OR p_invitee = v_uid THEN
    RAISE EXCEPTION 'Choose another resident';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commute_circle_members
    WHERE circle_id = p_circle_id AND user_id = v_uid AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the circle owner can invite';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commute_circle_members
    WHERE circle_id = p_circle_id AND user_id = p_invitee
  ) THEN
    RAISE EXCEPTION 'Already a member';
  END IF;

  IF public.get_user_society_id(p_invitee) = ANY (public.cleaner_city_allowed_society_ids(v_uid)) THEN
    v_allowed := true;
  END IF;
  SELECT split_part(lower(email), '@', 2) INTO v_domain_a
  FROM public.work_verifications
  WHERE user_id = v_uid AND status = 'verified'
  ORDER BY verified_at DESC NULLS LAST
  LIMIT 1;
  SELECT split_part(lower(email), '@', 2) INTO v_domain_b
  FROM public.work_verifications
  WHERE user_id = p_invitee AND status = 'verified'
  ORDER BY verified_at DESC NULLS LAST
  LIMIT 1;
  IF v_domain_a IS NOT NULL AND v_domain_a = v_domain_b THEN
    v_allowed := true;
  END IF;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invitee must share your society, a neighbour society, or your verified work domain';
  END IF;

  INSERT INTO public.commute_circle_invites (circle_id, inviter_user_id, invitee_user_id)
  VALUES (p_circle_id, v_uid, p_invitee)
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_enqueue_notify(
    p_invitee,
    'Circle invitation',
    'A neighbour invited you to a trusted commute circle. Accept or decline in Circles.',
    'cleaner_city_ride_update',
    NULL,
    public.get_user_society_id(p_invitee),
    'cc_circle_inv_' || v_row.id::text
  );
  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'expires_at', v_row.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_invite_to_circle(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_invite_to_circle(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_respond_circle_invite(p_invite_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_circle_invites;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_row FROM public.commute_circle_invites WHERE id = p_invite_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.invitee_user_id <> v_uid THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending';
  END IF;
  IF v_row.expires_at < now() THEN
    UPDATE public.commute_circle_invites SET status = 'expired', updated_at = now() WHERE id = v_row.id;
    RAISE EXCEPTION 'Invitation expired';
  END IF;
  IF COALESCE(p_accept, false) THEN
    INSERT INTO public.commute_circle_members (circle_id, user_id, role)
    VALUES (v_row.circle_id, v_uid, 'member')
    ON CONFLICT (circle_id, user_id) DO NOTHING;
    UPDATE public.commute_circle_invites SET status = 'accepted', updated_at = now() WHERE id = v_row.id;
  ELSE
    UPDATE public.commute_circle_invites SET status = 'rejected', updated_at = now() WHERE id = v_row.id;
  END IF;
  RETURN jsonb_build_object('id', v_row.id, 'accepted', COALESCE(p_accept, false));
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_respond_circle_invite(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_respond_circle_invite(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_my_circle_invites()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', i.id,
      'circle_id', i.circle_id,
      'circle_name', c.name,
      'status', i.status,
      'expires_at', i.expires_at
    ) ORDER BY i.created_at DESC)
    FROM public.commute_circle_invites i
    JOIN public.commute_circles c ON c.id = i.circle_id
    WHERE i.invitee_user_id = auth.uid()
      AND i.status = 'pending'
      AND i.expires_at > now()
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_my_circle_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_my_circle_invites() TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_circle_tomorrow_board(p_circle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tomorrow date := (timezone('Asia/Kolkata', now()))::date + 1;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.commute_circle_members
    WHERE circle_id = p_circle_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Not a circle member';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', p.host_user_id,
      'display_name', COALESCE(pr.name, 'Member'),
      'travel_date', p.travel_date,
      'direction', p.direction,
      'depart_time', p.depart_time,
      'seats_available', p.seats_available,
      'origin_label', COALESCE(p.origin_label, 'Pickup corridor'),
      'destination_label', COALESCE(p.destination_label, 'Drop corridor')
    ) ORDER BY p.depart_time)
    FROM public.commute_publications p
    JOIN public.commute_circle_members m ON m.user_id = p.host_user_id AND m.circle_id = p_circle_id
    JOIN public.commute_profiles cp ON cp.user_id = p.host_user_id AND cp.deleted_at IS NULL
    LEFT JOIN public.profiles pr ON pr.id = p.host_user_id
    WHERE p.travel_date = v_tomorrow
      AND p.status IN ('published', 'full')
      AND cp.show_on_circle_board = true
      AND cp.circle_visibility = 'members'
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_circle_tomorrow_board(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_circle_tomorrow_board(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_notify_circle_about_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  v_visible boolean;
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(circle_visibility, 'members') = 'members'
  INTO v_visible
  FROM public.commute_profiles
  WHERE user_id = NEW.host_user_id AND deleted_at IS NULL;
  IF NOT COALESCE(v_visible, false) THEN
    RETURN NEW;
  END IF;
  FOR m IN
    SELECT DISTINCT mem.user_id
    FROM public.commute_circle_members mine
    JOIN public.commute_circle_members mem ON mem.circle_id = mine.circle_id
    WHERE mine.user_id = NEW.host_user_id
      AND mem.user_id <> NEW.host_user_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.commute_blocks b
      WHERE (b.blocker_user_id = NEW.host_user_id AND b.blocked_user_id = m.user_id)
         OR (b.blocker_user_id = m.user_id AND b.blocked_user_id = NEW.host_user_id)
    ) THEN
      CONTINUE;
    END IF;
    PERFORM public.cleaner_city_enqueue_notify(
      m.user_id,
      'Circle commute tomorrow',
      'A circle member published a ' || replace(NEW.direction, '_', ' ') || ' commute for ' || NEW.travel_date::text || '. Open Find a ride. Exact pins stay hidden until you confirm.',
      'cleaner_city_ride_update',
      NULL,
      NEW.society_id,
      'cc_circle_pub_' || NEW.id::text || '_' || m.user_id::text
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaner_city_notify_circle_publication ON public.commute_publications;
CREATE TRIGGER cleaner_city_notify_circle_publication
  AFTER INSERT OR UPDATE OF status ON public.commute_publications
  FOR EACH ROW
  EXECUTE FUNCTION public.cleaner_city_notify_circle_about_publication();

-- ---------------------------------------------------------------------------
-- Meetup points: admin supplies coordinates. No seeded places.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_admin_upsert_meetup_point(
  p_society_id uuid,
  p_label text,
  p_latitude double precision,
  p_longitude double precision,
  p_kind text DEFAULT 'gate',
  p_point_id uuid DEFAULT NULL
)
RETURNS public.society_meetup_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.society_meetup_points;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_society_id IS NULL OR char_length(trim(COALESCE(p_label, ''))) < 2 THEN
    RAISE EXCEPTION 'Society and label are required';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180
     OR (p_latitude = 0 AND p_longitude = 0) THEN
    RAISE EXCEPTION 'Enter the real latitude and longitude for this place';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('gate', 'clubhouse', 'main_road', 'parking', 'other') THEN
    RAISE EXCEPTION 'Invalid meetup kind';
  END IF;
  IF p_point_id IS NULL THEN
    INSERT INTO public.society_meetup_points (society_id, label, latitude, longitude, kind, is_active, updated_at)
    VALUES (p_society_id, trim(p_label), p_latitude, p_longitude, p_kind, true, now())
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.society_meetup_points
    SET label = trim(p_label), latitude = p_latitude, longitude = p_longitude, kind = p_kind, updated_at = now()
    WHERE id = p_point_id AND society_id = p_society_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'Meetup point not found'; END IF;
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_upsert_meetup_point(uuid, text, double precision, double precision, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_upsert_meetup_point(uuid, text, double precision, double precision, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Safety: verify contacts, queue SMS, masked-call request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_sync_contact_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.notify_user_id IS NOT NULL THEN
    NEW.verified_at := COALESCE(NEW.verified_at, now());
    NEW.verification_method := COALESCE(NEW.verification_method, 'sociva_account');
  ELSIF TG_OP = 'UPDATE' AND NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.verified_at := NULL;
    NEW.verification_method := NULL;
    NEW.verify_hash := NULL;
    NEW.verify_salt := NULL;
    NEW.verify_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaner_city_sync_contact_verification ON public.commute_emergency_contacts;
CREATE TRIGGER cleaner_city_sync_contact_verification
  BEFORE INSERT OR UPDATE ON public.commute_emergency_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.cleaner_city_sync_contact_verification();

CREATE OR REPLACE FUNCTION public.cleaner_city_start_contact_verification(p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_emergency_contacts;
  v_code text;
  v_salt text;
  v_alert uuid;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_row FROM public.commute_emergency_contacts
  WHERE id = p_contact_id AND user_id = v_uid
  FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF v_row.notify_user_id IS NOT NULL THEN
    UPDATE public.commute_emergency_contacts
    SET verified_at = now(), verification_method = 'sociva_account', updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object('verified', true, 'method', 'sociva_account', 'sms_queued', false);
  END IF;
  IF v_row.phone IS NULL OR length(regexp_replace(v_row.phone, '[^0-9]', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'Add a phone number before verification';
  END IF;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_salt := encode(extensions.gen_random_bytes(8), 'hex');
  UPDATE public.commute_emergency_contacts
  SET verify_salt = v_salt,
      verify_hash = md5(v_salt || v_code),
      verify_expires_at = now() + interval '10 minutes',
      updated_at = now()
  WHERE id = v_row.id;
  INSERT INTO public.cleaner_city_outbound_alerts (
    user_id, channel, destination_phone, body
  ) VALUES (
    v_uid, 'sms', v_row.phone,
    'Sociva Cleaner City verification code ' || v_code || '. It expires in 10 minutes.'
  )
  RETURNING id INTO v_alert;
  RETURN jsonb_build_object(
    'verified', false,
    'method', 'sms_code',
    'sms_queued', true,
    'alert_id', v_alert
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_start_contact_verification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_start_contact_verification(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_confirm_contact_verification(p_contact_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_emergency_contacts;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_row FROM public.commute_emergency_contacts
  WHERE id = p_contact_id AND user_id = v_uid
  FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Contact not found'; END IF;
  IF v_row.verify_hash IS NULL OR v_row.verify_expires_at IS NULL OR v_row.verify_expires_at < now() THEN
    RAISE EXCEPTION 'Verification code expired';
  END IF;
  IF md5(v_row.verify_salt || trim(COALESCE(p_code, ''))) <> v_row.verify_hash THEN
    RAISE EXCEPTION 'Verification code did not match';
  END IF;
  UPDATE public.commute_emergency_contacts
  SET verified_at = now(),
      verification_method = 'sms_code',
      verify_hash = NULL,
      verify_salt = NULL,
      verify_expires_at = NULL,
      updated_at = now()
  WHERE id = v_row.id;
  RETURN jsonb_build_object('verified', true, 'method', 'sms_code');
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_confirm_contact_verification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_confirm_contact_verification(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_queue_sos_sms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  IF NEW.incident_type <> 'sos' THEN
    RETURN NEW;
  END IF;
  FOR c IN
    SELECT * FROM public.commute_emergency_contacts
    WHERE user_id = NEW.reporter_user_id
      AND phone IS NOT NULL
      AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 10
  LOOP
    INSERT INTO public.cleaner_city_outbound_alerts (
      user_id, ride_id, incident_id, channel, destination_phone, body
    ) VALUES (
      NEW.reporter_user_id,
      NEW.ride_id,
      NEW.id,
      'sms',
      c.phone,
      'Sociva Cleaner City SOS from your contact. Open the app. This is not a 112 call.'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaner_city_queue_sos_sms ON public.ride_incidents;
CREATE TRIGGER cleaner_city_queue_sos_sms
  AFTER INSERT ON public.ride_incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.cleaner_city_queue_sos_sms();

CREATE OR REPLACE FUNCTION public.cleaner_city_request_masked_call(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_other uuid;
  v_mine text;
  v_theirs text;
  v_alert uuid;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending', 'started') THEN
    RAISE EXCEPTION 'Calls are available after the seat is confirmed';
  END IF;
  v_other := CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END;
  SELECT NULLIF(trim(phone), '') INTO v_mine FROM public.profiles WHERE id = v_uid;
  SELECT NULLIF(trim(phone), '') INTO v_theirs FROM public.profiles WHERE id = v_other;
  IF v_mine IS NULL OR v_theirs IS NULL THEN
    RAISE EXCEPTION 'Both riders need a phone on their Sociva profile before a relay call';
  END IF;
  INSERT INTO public.cleaner_city_outbound_alerts (
    user_id, ride_id, channel, destination_phone, body
  ) VALUES (
    v_uid, p_ride_id, 'call', v_mine,
    v_theirs
  )
  RETURNING id INTO v_alert;
  RETURN jsonb_build_object('alert_id', v_alert, 'status', 'pending');
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_request_masked_call(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_request_masked_call(uuid) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_request_masked_call(uuid) IS
  'Queues a relay call. The destination phone is stored for the dispatcher only and is not returned.';

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
  SELECT COALESCE(circle_only_matching, false) INTO v_circle_only
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
    ELSIF COALESCE(v_circle_only, false) THEN
      CONTINUE;
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
$$;


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
  IF v_pub.origin_latitude IS NULL OR v_pub.destination_latitude IS NULL THEN
    RAISE EXCEPTION 'Publication missing route pins';
  END IF;

  -- Shared across publications. Must run before either EXISTS check.
  PERFORM public.cleaner_city_lock_guest_booking(v_uid, v_pub.travel_date, v_pub.direction);

  IF EXISTS (
    SELECT 1 FROM public.commute_seat_offers o
    WHERE o.publication_id = p_publication_id
      AND o.status = 'open'
      AND o.expires_at > now()
      AND o.user_id <> v_uid
  ) THEN
    RAISE EXCEPTION 'This seat is held for a waitlist offer';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.publication_id = p_publication_id
      AND r.guest_user_id = v_uid
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an open request for this ride';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rides r
    JOIN public.commute_publications p ON p.id = r.publication_id
    WHERE r.guest_user_id = v_uid
      AND r.travel_date = v_pub.travel_date
      AND p.direction = v_pub.direction
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an active ride for this date and direction';
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
  ELSE
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

  UPDATE public.commute_seat_offers
  SET status = 'accepted', updated_at = now()
  WHERE publication_id = p_publication_id
    AND user_id = v_uid
    AND status = 'open';

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


CREATE OR REPLACE FUNCTION public.cleaner_city_process_timeouts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req integer := 0;
  v_pick integer := 0;
  v_offers integer := 0;
  r record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  v_offers := public.cleaner_city_expire_seat_offers();

  FOR r IN
    SELECT * FROM public.rides
    WHERE status = 'requested'
      AND COALESCE(request_expires_at, created_at + interval '3 hours') < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.rides SET status = 'rejected', updated_at = now() WHERE id = r.id;
    IF r.publication_id IS NOT NULL THEN
      PERFORM public.cleaner_city_release_publication_seat(r.publication_id);
    END IF;
    PERFORM public.cleaner_city_enqueue_notify(
      r.guest_user_id,
      'Request expired',
      'The host did not respond in time. Your seat hold was released.',
      'cleaner_city_ride_update',
      r.id,
      r.society_id,
      'cc_req_ttl_' || r.id::text
    );
    v_req := v_req + 1;
  END LOOP;

  FOR r IN
    SELECT ri.*
    FROM public.rides ri
    JOIN public.commute_publications p ON p.id = ri.publication_id
    WHERE ri.status = 'pickup_pending'
      AND (
        (ri.pickup_deadline_at IS NOT NULL AND ri.pickup_deadline_at < now())
        OR (
          ri.pickup_deadline_at IS NULL
          AND (p.travel_date + p.depart_time) < (timezone('Asia/Kolkata', now()) - interval '30 minutes')
        )
      )
    FOR UPDATE OF ri SKIP LOCKED
  LOOP
    UPDATE public.rides SET status = 'no_show', updated_at = now() WHERE id = r.id;
    IF r.publication_id IS NOT NULL THEN
      PERFORM public.cleaner_city_release_publication_seat(r.publication_id);
    END IF;
    PERFORM public.cleaner_city_enqueue_notify(
      r.guest_user_id,
      'Pickup timed out',
      'This commute was closed as a no-show. Search again or check waitlist.',
      'cleaner_city_ride_update',
      r.id,
      r.society_id,
      'cc_pick_ttl_' || r.id::text
    );
    PERFORM public.cleaner_city_enqueue_notify(
      r.host_user_id,
      'Pickup timed out',
      'A ride was closed as a no-show after the pickup window.',
      'cleaner_city_ride_update',
      r.id,
      r.society_id,
      'cc_pick_ttl_h_' || r.id::text
    );
    v_pick := v_pick + 1;
  END LOOP;

  RETURN jsonb_build_object('expired_requests', v_req, 'pickup_no_shows', v_pick, 'expired_offers', v_offers);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Guest double-booking protection (same date + direction)
-- ---------------------------------------------------------------------------
