-- Remaining Cleaner City product: discovery prefs, extra stops, named backup,
-- dispute appeal, vehicle file review, ride and circle chat, badges,
-- fuel payment records, ranked meetup points from rows that already exist.
-- Does not insert meetup coordinates. Does not run against production by itself.

ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS require_circle_history boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_city_matching boolean NOT NULL DEFAULT false;

ALTER TABLE public.vehicle_documents
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.commute_publication_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.commute_publications(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 2),
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 2 AND 80),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, seq)
);

CREATE TABLE IF NOT EXISTS public.ride_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_chat_messages_ride
  ON public.ride_chat_messages (ride_id, created_at);

CREATE TABLE IF NOT EXISTS public.commute_circle_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.commute_circles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commute_circle_messages_circle
  ON public.commute_circle_messages (circle_id, created_at);

CREATE TABLE IF NOT EXISTS public.cleaner_city_badges (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_key text NOT NULL CHECK (badge_key IN (
    'first_ride', 'five_rides', 'ten_rides', 'reliable_host', 'circle_rider'
  )),
  earned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_key)
);

CREATE TABLE IF NOT EXISTS public.ride_dispute_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL UNIQUE REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prior_status text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'appealed', 'upheld', 'dismissed')),
  appeal_note text,
  appeal_by uuid,
  appealed_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ride_fuel_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  cost_share_id uuid REFERENCES public.ride_cost_shares(id) ON DELETE SET NULL,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  payer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_paise integer NOT NULL CHECK (amount_paise >= 100),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'failed')),
  razorpay_order_id text,
  razorpay_payment_id text,
  payout_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payout_status IN ('unpaid', 'payable', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ride_fuel_payments_ride
  ON public.ride_fuel_payments (ride_id, created_at DESC);

ALTER TABLE public.commute_publication_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commute_circle_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaner_city_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_dispute_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_fuel_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_publication_stops_select ON public.commute_publication_stops;
CREATE POLICY commute_publication_stops_select ON public.commute_publication_stops
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.commute_publications p
      WHERE p.id = publication_id AND p.host_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.publication_id = commute_publication_stops.publication_id
        AND r.guest_user_id = auth.uid()
        AND r.status IN ('confirmed', 'pickup_pending', 'started', 'completed')
    )
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS commute_publication_stops_write ON public.commute_publication_stops;
CREATE POLICY commute_publication_stops_write ON public.commute_publication_stops
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.commute_publications p
      WHERE p.id = publication_id AND p.host_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.commute_publications p
      WHERE p.id = publication_id AND p.host_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ride_chat_messages_select ON public.ride_chat_messages;
CREATE POLICY ride_chat_messages_select ON public.ride_chat_messages
  FOR SELECT TO authenticated
  USING (
    public.cleaner_city_is_ride_participant(ride_id, auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.commute_blocks b
      WHERE (b.blocker_user_id = auth.uid() AND b.blocked_user_id = sender_id)
         OR (b.blocker_user_id = sender_id AND b.blocked_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS ride_chat_messages_insert ON public.ride_chat_messages;
CREATE POLICY ride_chat_messages_insert ON public.ride_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.cleaner_city_is_ride_participant(ride_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND r.society_id = society_id
        AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started', 'completed')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.rides r
      JOIN public.commute_blocks b ON (
        (b.blocker_user_id = r.host_user_id AND b.blocked_user_id = r.guest_user_id)
        OR (b.blocker_user_id = r.guest_user_id AND b.blocked_user_id = r.host_user_id)
      )
      WHERE r.id = ride_id
    )
  );

DROP POLICY IF EXISTS commute_circle_messages_select ON public.commute_circle_messages;
CREATE POLICY commute_circle_messages_select ON public.commute_circle_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.commute_circle_members m
      WHERE m.circle_id = commute_circle_messages.circle_id AND m.user_id = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.commute_blocks b
      WHERE (b.blocker_user_id = auth.uid() AND b.blocked_user_id = sender_id)
         OR (b.blocker_user_id = sender_id AND b.blocked_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS commute_circle_messages_insert ON public.commute_circle_messages;
CREATE POLICY commute_circle_messages_insert ON public.commute_circle_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.commute_circle_members m
      JOIN public.commute_circles c ON c.id = m.circle_id AND c.is_active
      WHERE m.circle_id = commute_circle_messages.circle_id
        AND m.user_id = auth.uid()
        AND c.society_id = society_id
    )
  );

DROP POLICY IF EXISTS cleaner_city_badges_select ON public.cleaner_city_badges;
CREATE POLICY cleaner_city_badges_select ON public.cleaner_city_badges
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS ride_dispute_cases_select ON public.ride_dispute_cases;
CREATE POLICY ride_dispute_cases_select ON public.ride_dispute_cases
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR opened_by = auth.uid()
    OR appeal_by = auth.uid()
    OR public.cleaner_city_is_ride_participant(ride_id, auth.uid())
  );

DROP POLICY IF EXISTS ride_fuel_payments_select ON public.ride_fuel_payments;
CREATE POLICY ride_fuel_payments_select ON public.ride_fuel_payments
  FOR SELECT TO authenticated
  USING (payer_id = auth.uid() OR payee_id = auth.uid() OR public.is_admin(auth.uid()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-documents', 'vehicle-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS vehicle_documents_storage_select ON storage.objects;
CREATE POLICY vehicle_documents_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS vehicle_documents_storage_insert ON storage.objects;
CREATE POLICY vehicle_documents_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS vehicle_documents_storage_update ON storage.objects;
CREATE POLICY vehicle_documents_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS vehicle_documents_storage_delete ON storage.objects;
CREATE POLICY vehicle_documents_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vehicle-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE OR REPLACE FUNCTION public.cleaner_city_chat_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF TG_TABLE_NAME = 'ride_chat_messages' THEN
    SELECT count(*) INTO v_count
    FROM public.ride_chat_messages
    WHERE sender_id = NEW.sender_id AND created_at > now() - interval '10 minutes';
  ELSE
    SELECT count(*) INTO v_count
    FROM public.commute_circle_messages
    WHERE sender_id = NEW.sender_id AND created_at > now() - interval '10 minutes';
  END IF;
  IF COALESCE(v_count, 0) >= 20 THEN
    RAISE EXCEPTION 'Too many messages. Wait a few minutes.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ride_chat_rate_limit ON public.ride_chat_messages;
CREATE TRIGGER ride_chat_rate_limit
  BEFORE INSERT ON public.ride_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_chat_rate_limit();

DROP TRIGGER IF EXISTS circle_chat_rate_limit ON public.commute_circle_messages;
CREATE TRIGGER circle_chat_rate_limit
  BEFORE INSERT ON public.commute_circle_messages
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_chat_rate_limit();

CREATE OR REPLACE FUNCTION public.cleaner_city_circle_message_society()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT c.society_id INTO NEW.society_id
  FROM public.commute_circles c
  WHERE c.id = NEW.circle_id;
  IF NEW.society_id IS NULL THEN
    RAISE EXCEPTION 'Circle not found';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS circle_message_society ON public.commute_circle_messages;
CREATE TRIGGER circle_message_society
  BEFORE INSERT ON public.commute_circle_messages
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_circle_message_society();

CREATE OR REPLACE FUNCTION public.cleaner_city_set_discovery_prefs(
  p_circle_only boolean,
  p_visibility text,
  p_show_on_board boolean,
  p_require_circle_history boolean,
  p_open_city boolean
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
      updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_discovery_prefs(boolean, text, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_discovery_prefs(boolean, text, boolean, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_set_publication_stop(
  p_publication_id uuid,
  p_seq integer,
  p_label text,
  p_latitude double precision,
  p_longitude double precision
)
RETURNS public.commute_publication_stops
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pub public.commute_publications;
  v_row public.commute_publication_stops;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_seq IS NULL OR p_seq NOT IN (1, 2) THEN
    RAISE EXCEPTION 'A commute can have stop 1 and stop 2 only';
  END IF;
  IF p_label IS NULL OR char_length(trim(p_label)) < 2 THEN
    RAISE EXCEPTION 'Stop label is required';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180
     OR (p_latitude = 0 AND p_longitude = 0) THEN
    RAISE EXCEPTION 'Enter the real stop latitude and longitude';
  END IF;
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id;
  IF v_pub.id IS NULL OR v_pub.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Publication not found';
  END IF;
  IF v_pub.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Stops can be edited on a draft or published commute';
  END IF;
  INSERT INTO public.commute_publication_stops (
    publication_id, society_id, seq, label, latitude, longitude
  ) VALUES (
    v_pub.id, v_pub.society_id, p_seq, trim(p_label), p_latitude, p_longitude
  )
  ON CONFLICT (publication_id, seq) DO UPDATE
  SET label = EXCLUDED.label,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_publication_stop(uuid, integer, text, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_publication_stop(uuid, integer, text, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_clear_publication_stop(
  p_publication_id uuid,
  p_seq integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  DELETE FROM public.commute_publication_stops s
  USING public.commute_publications p
  WHERE s.publication_id = p.id
    AND p.id = p_publication_id
    AND p.host_user_id = v_uid
    AND s.seq = p_seq;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_clear_publication_stop(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_clear_publication_stop(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_offer_named_backup(
  p_guest uuid,
  p_travel_date date,
  p_direction text,
  p_exclude_publication uuid,
  p_guest_lat double precision,
  p_guest_lng double precision,
  p_guest_dest_lat double precision,
  p_guest_dest_lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub public.commute_publications;
  v_name text;
  v_detour jsonb;
  v_minutes numeric;
  v_body text;
  v_allowed uuid[];
  v_guest_open boolean := false;
BEGIN
  IF p_guest IS NULL OR p_travel_date IS NULL OR p_direction IS NULL THEN
    RETURN jsonb_build_object('offered', false);
  END IF;
  SELECT COALESCE(open_city_matching, false) INTO v_guest_open
  FROM public.commute_profiles WHERE user_id = p_guest AND deleted_at IS NULL;
  v_allowed := public.cleaner_city_allowed_society_ids(p_guest);

  SELECT p.* INTO v_pub
  FROM public.commute_publications p
  JOIN public.commute_profiles hp
    ON hp.user_id = p.host_user_id AND hp.deleted_at IS NULL
  WHERE p.status = 'published'
    AND p.travel_date = p_travel_date
    AND p.direction = p_direction
    AND p.seats_available > 0
    AND p.host_user_id <> p_guest
    AND (p_exclude_publication IS NULL OR p.id <> p_exclude_publication)
    AND (
      p.society_id = ANY (v_allowed)
      OR (v_guest_open AND COALESCE(hp.open_city_matching, false))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.commute_blocks b
      WHERE (b.blocker_user_id = p_guest AND b.blocked_user_id = p.host_user_id)
         OR (b.blocker_user_id = p.host_user_id AND b.blocked_user_id = p_guest)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.commute_seat_offers o
      WHERE o.publication_id = p.id AND o.status = 'open' AND o.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.guest_user_id = p_guest
        AND r.travel_date = p_travel_date
        AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
    )
  ORDER BY p.seats_available DESC, p.created_at
  LIMIT 1;

  IF v_pub.id IS NULL THEN
    RETURN jsonb_build_object('offered', false);
  END IF;

  SELECT COALESCE(pr.name, 'A neighbour') INTO v_name
  FROM public.profiles pr WHERE pr.id = v_pub.host_user_id;

  v_minutes := NULL;
  IF p_guest_lat IS NOT NULL AND p_guest_dest_lat IS NOT NULL
     AND v_pub.origin_latitude IS NOT NULL AND v_pub.destination_latitude IS NOT NULL THEN
    v_detour := public.cleaner_city_estimate_detour_minutes(
      v_pub.origin_latitude, v_pub.origin_longitude,
      v_pub.destination_latitude, v_pub.destination_longitude,
      p_guest_lat, p_guest_lng, p_guest_dest_lat, p_guest_dest_lng, 25
    );
    IF COALESCE((v_detour->>'ok')::boolean, false) THEN
      v_minutes := round((v_detour->>'estimated_detour_minutes')::numeric, 0);
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.commute_seat_offers (publication_id, user_id, society_id, expires_at)
    VALUES (v_pub.id, p_guest, v_pub.society_id, now() + interval '10 minutes');
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('offered', false);
  END;

  v_body := v_name || ' has 1 seat';
  IF v_minutes IS NOT NULL THEN
    v_body := v_body || ', about ' || v_minutes::text || ' min extra';
  END IF;
  v_body := v_body || '. Request it within 10 minutes.';

  PERFORM public.cleaner_city_enqueue_notify(
    p_guest,
    v_name || ' has 1 seat',
    v_body,
    'cleaner_city_ride_update',
    NULL,
    v_pub.society_id,
    'cc_backup_' || v_pub.id::text || '_' || p_guest::text || '_' || p_travel_date::text
  );

  RETURN jsonb_build_object(
    'offered', true,
    'publication_id', v_pub.id,
    'host_name', v_name,
    'detour_minutes', v_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_offer_named_backup(uuid, date, text, uuid, double precision, double precision, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_offer_named_backup(uuid, date, text, uuid, double precision, double precision, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_rank_meetup_points(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_pub public.commute_publications;
  v_guest_lat double precision;
  v_guest_lng double precision;
  v_host_lat double precision;
  v_host_lng double precision;
  v_dest_lat double precision;
  v_dest_lng double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id;
  v_guest_lat := COALESCE(v_ride.guest_pickup_latitude, v_pub.origin_latitude);
  v_guest_lng := COALESCE(v_ride.guest_pickup_longitude, v_pub.origin_longitude);
  v_host_lat := v_pub.origin_latitude;
  v_host_lng := v_pub.origin_longitude;
  v_dest_lat := COALESCE(v_ride.guest_dest_latitude, v_pub.destination_latitude);
  v_dest_lng := COALESCE(v_ride.guest_dest_longitude, v_pub.destination_longitude);
  IF v_guest_lat IS NULL OR v_host_lat IS NULL OR v_dest_lat IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(s)::jsonb)
    FROM (
      SELECT
        mp.id,
        mp.label,
        mp.kind,
        mp.latitude,
        mp.longitude,
        round(public.cleaner_city_haversine_meters(v_guest_lat, v_guest_lng, mp.latitude, mp.longitude)::numeric, 0) AS walk_meters,
        round((
          GREATEST(
            0,
            public.cleaner_city_haversine_meters(v_host_lat, v_host_lng, mp.latitude, mp.longitude)
            + public.cleaner_city_haversine_meters(mp.latitude, mp.longitude, v_dest_lat, v_dest_lng)
            - public.cleaner_city_haversine_meters(v_host_lat, v_host_lng, v_dest_lat, v_dest_lng)
          ) / 416.7
        )::numeric, 1) AS detour_minutes
      FROM public.society_meetup_points mp
      WHERE mp.is_active
        AND mp.society_id IN (v_ride.society_id, v_pub.society_id)
      ORDER BY (
        public.cleaner_city_haversine_meters(v_guest_lat, v_guest_lng, mp.latitude, mp.longitude)
        + GREATEST(
          0,
          public.cleaner_city_haversine_meters(v_host_lat, v_host_lng, mp.latitude, mp.longitude)
          + public.cleaner_city_haversine_meters(mp.latitude, mp.longitude, v_dest_lat, v_dest_lng)
          - public.cleaner_city_haversine_meters(v_host_lat, v_host_lng, v_dest_lat, v_dest_lng)
        )
      )
      LIMIT 3
    ) s
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_rank_meetup_points(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_rank_meetup_points(uuid) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_rank_meetup_points(uuid) IS
  'Ranks meetup points already saved for the ride societies. Returns an empty list when none exist. Does not invent coordinates.';
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
  v_booked public.rides;
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
    INSERT INTO public.commute_publication_stops (
      publication_id, society_id, seq, label, latitude, longitude
    )
    SELECT v_pub.id, v_pub.society_id, s.seq, s.label, s.latitude, s.longitude
    FROM public.commute_publication_stops s
    WHERE s.publication_id = v_last.id;
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
  v_booked := public.cleaner_city_request_ride(
    v_existing,
    'repeat last commute',
    v_ride.guest_pickup_latitude,
    v_ride.guest_pickup_longitude,
    v_ride.guest_dest_latitude,
    v_ride.guest_dest_longitude
  );
  RETURN jsonb_build_object(
    'action', 'booked',
    'publication_id', v_existing,
    'ride_id', v_booked.id,
    'travel_date', v_date,
    'direction', v_last.direction
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_repeat_last_commute() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_repeat_last_commute() TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_cancel_publication(
  p_publication_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.commute_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_publications;
  r record;
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_row
  FROM public.commute_publications
  WHERE id = p_publication_id
  FOR UPDATE;

  IF v_row.id IS NULL OR v_row.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Publication not found or already closed';
  END IF;

  IF v_row.status = 'cancelled' THEN
    RETURN v_row;
  END IF;

  IF v_row.status NOT IN ('draft', 'published', 'full') THEN
    RAISE EXCEPTION 'Publication not found or already closed';
  END IF;

  FOR r IN
    SELECT * FROM public.rides
    WHERE publication_id = p_publication_id
      AND status IN ('requested', 'confirmed', 'pickup_pending', 'started')
    FOR UPDATE
  LOOP
    UPDATE public.rides
    SET status = 'cancelled', updated_at = now()
    WHERE id = r.id;

    PERFORM public.cleaner_city_append_ride_event(
      r.id, r.society_id, v_uid, 'cancelled_by_publication',
      r.status, 'cancelled',
      jsonb_build_object('reason', v_reason, 'publication_id', p_publication_id)
    );

    IF r.guest_user_id IS NOT NULL THEN
      PERFORM public.cleaner_city_enqueue_notify(
        r.guest_user_id,
        'Host cancelled the commute',
        COALESCE(
          'Your host cancelled this publication' || CASE WHEN v_reason IS NOT NULL THEN (': ' || v_reason) ELSE '.' END
            || ' A backup seat is offered when another neighbour is publishing.',
          'Your host cancelled this commute.'
        ),
        'cleaner_city_ride_update',
        r.id,
        r.society_id,
        'cc_pub_cancel_' || p_publication_id::text || '_' || r.id::text
      );
      PERFORM public.cleaner_city_offer_named_backup(
        r.guest_user_id,
        r.travel_date,
        v_row.direction,
        p_publication_id,
        r.guest_pickup_latitude,
        r.guest_pickup_longitude,
        r.guest_dest_latitude,
        r.guest_dest_longitude
      );
    END IF;
  END LOOP;

  UPDATE public.commute_publications
  SET status = 'cancelled',
      seats_available = 0,
      updated_at = now()
  WHERE id = p_publication_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_cancel_publication(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_cancel_publication(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_cancel_ride(
  p_ride_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_from text;
  v_other uuid;
  v_direction text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('requested', 'confirmed', 'pickup_pending') THEN
    RAISE EXCEPTION 'Ride cannot be cancelled in status %', v_ride.status;
  END IF;

  v_from := v_ride.status;
  v_other := CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END;
  SELECT direction INTO v_direction FROM public.commute_publications WHERE id = v_ride.publication_id;

  UPDATE public.rides
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  IF v_ride.publication_id IS NOT NULL THEN
    PERFORM public.cleaner_city_release_publication_seat(v_ride.publication_id);
  END IF;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'cancelled', v_from, 'cancelled',
    jsonb_build_object('reason', NULLIF(trim(COALESCE(p_reason, '')), ''))
  );

  IF v_other IS NOT NULL THEN
    PERFORM public.cleaner_city_enqueue_notify(
      v_other,
      'Ride cancelled',
      'Your commute ride was cancelled.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_cancel_' || v_ride.id::text
    );
  END IF;

  IF v_uid = v_ride.host_user_id AND v_ride.guest_user_id IS NOT NULL AND v_direction IS NOT NULL THEN
    PERFORM public.cleaner_city_offer_named_backup(
      v_ride.guest_user_id,
      v_ride.travel_date,
      v_direction,
      v_ride.publication_id,
      v_ride.guest_pickup_latitude,
      v_ride.guest_pickup_longitude,
      v_ride.guest_dest_latitude,
      v_ride.guest_dest_longitude
    );
  END IF;

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_cancel_ride(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_cancel_ride(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_dispute_ride(p_ride_id uuid, p_note text DEFAULT NULL)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_prior text;
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
  v_prior := v_ride.status;
  UPDATE public.rides
  SET status = 'disputed', updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;
  INSERT INTO public.ride_dispute_cases (
    ride_id, society_id, opened_by, prior_status, note, status
  ) VALUES (
    v_ride.id, v_ride.society_id, v_uid, v_prior,
    NULLIF(trim(COALESCE(p_note, '')), ''), 'open'
  );
  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'disputed', v_prior, 'disputed',
    jsonb_build_object('note', NULLIF(trim(COALESCE(p_note, '')), ''))
  );
  PERFORM public.cleaner_city_enqueue_notify(
    CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END,
    'Ride disputed',
    'The other person opened a dispute on this commute. You can appeal, and an admin can resolve it.',
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

CREATE OR REPLACE FUNCTION public.cleaner_city_appeal_dispute(
  p_ride_id uuid,
  p_note text
)
RETURNS public.ride_dispute_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_case public.ride_dispute_cases;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF p_note IS NULL OR char_length(trim(p_note)) < 4 THEN
    RAISE EXCEPTION 'Explain the appeal in a short note';
  END IF;
  SELECT * INTO v_case FROM public.ride_dispute_cases WHERE ride_id = p_ride_id FOR UPDATE;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'No dispute to appeal';
  END IF;
  IF NOT public.cleaner_city_is_ride_participant(p_ride_id, v_uid) THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_case.status <> 'open' THEN
    RAISE EXCEPTION 'This dispute is already appealed or resolved';
  END IF;
  UPDATE public.ride_dispute_cases
  SET status = 'appealed',
      appeal_note = trim(p_note),
      appeal_by = v_uid,
      appealed_at = now()
  WHERE id = v_case.id
  RETURNING * INTO v_case;
  RETURN v_case;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_appeal_dispute(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_appeal_dispute(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_resolve_dispute(
  p_ride_id uuid,
  p_outcome text,
  p_note text DEFAULT NULL
)
RETURNS public.ride_dispute_cases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_case public.ride_dispute_cases;
  v_ride public.rides;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('upheld', 'dismissed') THEN
    RAISE EXCEPTION 'Outcome must be upheld or dismissed';
  END IF;
  SELECT * INTO v_case FROM public.ride_dispute_cases WHERE ride_id = p_ride_id FOR UPDATE;
  IF v_case.id IS NULL THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  IF v_case.status IN ('upheld', 'dismissed') THEN
    RAISE EXCEPTION 'Dispute already resolved';
  END IF;
  UPDATE public.ride_dispute_cases
  SET status = p_outcome,
      resolved_by = v_uid,
      resolved_at = now(),
      resolution_note = NULLIF(trim(COALESCE(p_note, '')), '')
  WHERE id = v_case.id
  RETURNING * INTO v_case;

  IF p_outcome = 'dismissed' AND v_case.prior_status IN ('no_show', 'completed', 'cancelled') THEN
    UPDATE public.rides
    SET status = v_case.prior_status, updated_at = now()
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;
  ELSE
    SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  END IF;

  PERFORM public.cleaner_city_append_ride_event(
    p_ride_id, v_case.society_id, v_uid, 'dispute_resolved',
    'disputed', v_ride.status,
    jsonb_build_object('outcome', p_outcome, 'note', v_case.resolution_note)
  );
  PERFORM public.cleaner_city_enqueue_notify(
    v_ride.host_user_id,
    'Dispute ' || p_outcome,
    COALESCE(v_case.resolution_note, 'An admin resolved this commute dispute.'),
    'cleaner_city_ride_update', p_ride_id, v_case.society_id,
    'cc_dispute_res_h_' || p_ride_id::text
  );
  PERFORM public.cleaner_city_enqueue_notify(
    v_ride.guest_user_id,
    'Dispute ' || p_outcome,
    COALESCE(v_case.resolution_note, 'An admin resolved this commute dispute.'),
    'cleaner_city_ride_update', p_ride_id, v_case.society_id,
    'cc_dispute_res_g_' || p_ride_id::text
  );
  RETURN v_case;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_resolve_dispute(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_resolve_dispute(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_admin_review_vehicle_document(
  p_document_id uuid,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS public.vehicle_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.vehicle_documents;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Status must be verified or rejected';
  END IF;
  UPDATE public.vehicle_documents
  SET status = p_status,
      reviewed_by = v_uid,
      review_note = NULLIF(trim(COALESCE(p_note, '')), ''),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_document_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  PERFORM public.cleaner_city_enqueue_notify(
    v_row.user_id,
    CASE WHEN p_status = 'verified' THEN 'Vehicle document verified' ELSE 'Vehicle document rejected' END,
    COALESCE(v_row.review_note, 'An admin reviewed your vehicle document.'),
    'cleaner_city_ride_update',
    NULL,
    v_row.society_id,
    'cc_doc_' || v_row.id::text || '_' || p_status
  );
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_admin_review_vehicle_document(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_admin_review_vehicle_document(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_upsert_vehicle_document(
  p_vehicle_id uuid,
  p_document_type text,
  p_label text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_document_id uuid DEFAULT NULL
)
RETURNS public.vehicle_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_owner uuid;
  v_row public.vehicle_documents;
  v_path text := NULLIF(trim(COALESCE(p_storage_path, '')), '');
BEGIN
  v_society := public.cleaner_city_assert_host_access(v_uid);

  IF p_document_type IS NULL OR p_document_type NOT IN ('registration', 'insurance', 'licence', 'other') THEN
    RAISE EXCEPTION 'Invalid document_type';
  END IF;
  IF v_path IS NOT NULL AND split_part(v_path, '/', 1) <> v_uid::text THEN
    RAISE EXCEPTION 'Document file must be stored in your folder';
  END IF;

  SELECT user_id INTO v_owner FROM public.vehicles WHERE id = p_vehicle_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;

  IF p_document_id IS NOT NULL THEN
    UPDATE public.vehicle_documents d
    SET
      document_type = p_document_type,
      label = NULLIF(trim(COALESCE(p_label, '')), ''),
      storage_path = v_path,
      notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
      status = 'uploaded',
      reviewed_by = NULL,
      review_note = NULL,
      reviewed_at = NULL,
      updated_at = now()
    WHERE d.id = p_document_id AND d.user_id = v_uid AND d.vehicle_id = p_vehicle_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Document not found';
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO public.vehicle_documents (
    vehicle_id, user_id, society_id, document_type, status, label, storage_path, notes, updated_at
  )
  VALUES (
    p_vehicle_id, v_uid, v_society, p_document_type, 'uploaded',
    NULLIF(trim(COALESCE(p_label, '')), ''),
    v_path,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    now()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_upsert_vehicle_document(uuid, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_upsert_vehicle_document(uuid, text, text, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_refresh_badges(p_user uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed integer;
  v_host_completed integer;
  v_host_no_show integer;
  v_in_circle boolean;
  v_added integer := 0;
BEGIN
  IF p_user IS NULL THEN
    RETURN 0;
  END IF;
  SELECT count(*) INTO v_completed
  FROM public.rides
  WHERE status = 'completed' AND (host_user_id = p_user OR guest_user_id = p_user);
  SELECT count(*) INTO v_host_completed
  FROM public.rides
  WHERE status = 'completed' AND host_user_id = p_user;
  SELECT count(*) INTO v_host_no_show
  FROM public.rides
  WHERE status = 'no_show' AND host_user_id = p_user;
  SELECT EXISTS (
    SELECT 1 FROM public.commute_circle_members WHERE user_id = p_user
  ) INTO v_in_circle;

  IF v_completed >= 1 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'first_ride')
    ON CONFLICT DO NOTHING;
    v_added := v_added + 1;
  END IF;
  IF v_completed >= 5 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'five_rides')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_completed >= 10 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'ten_rides')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_host_completed >= 5 AND COALESCE(v_host_no_show, 0) = 0 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'reliable_host')
    ON CONFLICT DO NOTHING;
  END IF;
  IF v_in_circle AND v_completed >= 2 THEN
    INSERT INTO public.cleaner_city_badges (user_id, badge_key) VALUES (p_user, 'circle_rider')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_refresh_badges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_refresh_badges(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_badges_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.cleaner_city_refresh_badges(NEW.host_user_id);
    PERFORM public.cleaner_city_refresh_badges(NEW.guest_user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaner_city_badges_on_complete ON public.rides;
CREATE TRIGGER cleaner_city_badges_on_complete
  AFTER UPDATE OF status ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.cleaner_city_badges_on_complete();

CREATE OR REPLACE FUNCTION public.cleaner_city_start_fuel_payment(p_ride_id uuid)
RETURNS public.ride_fuel_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_share public.ride_cost_shares;
  v_amount integer;
  v_row public.ride_fuel_payments;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Only the guest pays the fuel share';
  END IF;
  IF v_ride.status <> 'completed' THEN
    RAISE EXCEPTION 'Fuel is paid after the ride is completed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ride_fuel_payments
    WHERE ride_id = p_ride_id AND status = 'paid'
  ) THEN
    RAISE EXCEPTION 'Fuel for this ride is already paid';
  END IF;
  SELECT * INTO v_share
  FROM public.ride_cost_shares
  WHERE ride_id = p_ride_id AND status = 'accepted'
  ORDER BY updated_at DESC
  LIMIT 1;
  v_amount := COALESCE(v_share.amount_paise, v_ride.estimated_fuel_paise);
  IF v_amount IS NULL OR v_amount < 100 THEN
    RAISE EXCEPTION 'Agree a fuel amount of at least 1 rupee first';
  END IF;
  UPDATE public.ride_fuel_payments
  SET status = 'failed'
  WHERE ride_id = p_ride_id AND status = 'pending';
  INSERT INTO public.ride_fuel_payments (
    ride_id, cost_share_id, society_id, payer_id, payee_id, amount_paise, status, payout_status
  ) VALUES (
    v_ride.id, v_share.id, v_ride.society_id, v_uid, v_ride.host_user_id, v_amount, 'pending', 'unpaid'
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_start_fuel_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_start_fuel_payment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_attach_fuel_order(
  p_payment_id uuid,
  p_razorpay_order_id text
)
RETURNS public.ride_fuel_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ride_fuel_payments;
BEGIN
  IF p_razorpay_order_id IS NULL OR char_length(trim(p_razorpay_order_id)) < 4 THEN
    RAISE EXCEPTION 'Razorpay order id is required';
  END IF;
  UPDATE public.ride_fuel_payments
  SET razorpay_order_id = trim(p_razorpay_order_id)
  WHERE id = p_payment_id
    AND payer_id = v_uid
    AND status = 'pending'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Fuel payment not found';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_attach_fuel_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_attach_fuel_order(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_confirm_fuel_payment(
  p_payment_id uuid,
  p_razorpay_order_id text,
  p_razorpay_payment_id text
)
RETURNS public.ride_fuel_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ride_fuel_payments;
BEGIN
  IF COALESCE(auth.role(), current_user) NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  UPDATE public.ride_fuel_payments
  SET status = 'paid',
      payout_status = 'payable',
      razorpay_order_id = trim(p_razorpay_order_id),
      razorpay_payment_id = trim(p_razorpay_payment_id),
      paid_at = now()
  WHERE id = p_payment_id
    AND status = 'pending'
    AND razorpay_order_id = trim(p_razorpay_order_id)
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Fuel payment not found';
  END IF;
  IF v_row.cost_share_id IS NOT NULL THEN
    UPDATE public.ride_cost_shares
    SET status = 'settled', updated_at = now()
    WHERE id = v_row.cost_share_id AND status = 'accepted';
  END IF;
  PERFORM public.cleaner_city_enqueue_notify(
    v_row.payee_id,
    'Fuel share paid',
    'The guest paid the agreed fuel share. The amount is recorded as payable to you. A bank transfer waits until a Razorpay route account is linked.',
    'cleaner_city_ride_update',
    v_row.ride_id,
    v_row.society_id,
    'cc_fuel_' || v_row.id::text
  );
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_confirm_fuel_payment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_confirm_fuel_payment(uuid, text, text) TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cleaner_city_confirm_fuel_payment(uuid, text, text) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.cleaner_city_confirm_fuel_payment(uuid, text, text) FROM authenticated';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cleaner_city_fail_fuel_payment(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ride_fuel_payments
  SET status = 'failed'
  WHERE id = p_payment_id
    AND status = 'pending'
    AND payer_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_fail_fuel_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_fail_fuel_payment(uuid) TO authenticated;

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

    SELECT min(public.cleaner_city_haversine_meters(
      p_guest_dest_lat, p_guest_dest_lng, s.latitude, s.longitude
    )) INTO v_stop_m
    FROM public.commute_publication_stops s
    WHERE s.publication_id = r.publication_id
      AND p_guest_dest_lat IS NOT NULL
      AND p_guest_dest_lng IS NOT NULL;
    IF v_stop_m IS NOT NULL AND v_stop_m <= (v_dest_km * 1000.0) THEN
      v_reasons := array_append(v_reasons, 'drop_near_extra_stop');
      v_score := v_score + 12;
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
      'hard_route_overlap', v_hard_overlap
    ),
    'matches', (
      SELECT COALESCE(jsonb_agg(elem ORDER BY (elem->>'score')::numeric DESC), '[]'::jsonb)
      FROM jsonb_array_elements(v_results) elem
    )
  );
END;
$$;


