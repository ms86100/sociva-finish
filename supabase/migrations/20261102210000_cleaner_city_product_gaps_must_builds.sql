-- Cleaner City product gaps + five must-builds (Phases 1-4 backend)
-- Autopilot, waitlist, timeouts/no_show, fuel estimate, meeting points,
-- emergency contacts, quick messages, circles, harder overlap, SOS fan-out.

-- ---------------------------------------------------------------------------
-- Profile autopilot flags
-- ---------------------------------------------------------------------------
ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopilot_confirm_mode text NOT NULL DEFAULT 'confirm'
    CHECK (autopilot_confirm_mode IN ('confirm', 'auto'));

COMMENT ON COLUMN public.commute_profiles.autopilot_enabled IS
  'When true, evening autopilot drafts/publishes tomorrow seats from schedule.';
COMMENT ON COLUMN public.commute_profiles.autopilot_confirm_mode IS
  'confirm = draft + push; auto = publish when pins/vehicle ready.';

-- Ride enrichment
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS guest_pickup_latitude double precision,
  ADD COLUMN IF NOT EXISTS guest_pickup_longitude double precision,
  ADD COLUMN IF NOT EXISTS guest_dest_latitude double precision,
  ADD COLUMN IF NOT EXISTS guest_dest_longitude double precision,
  ADD COLUMN IF NOT EXISTS meeting_point_label text,
  ADD COLUMN IF NOT EXISTS meeting_point_latitude double precision,
  ADD COLUMN IF NOT EXISTS meeting_point_longitude double precision,
  ADD COLUMN IF NOT EXISTS estimated_fuel_paise integer,
  ADD COLUMN IF NOT EXISTS request_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_deadline_at timestamptz;

-- ---------------------------------------------------------------------------
-- Waitlist
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commute_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  travel_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('to_office', 'to_home')),
  depart_time time,
  pickup_latitude double precision,
  pickup_longitude double precision,
  dest_latitude double precision,
  dest_longitude double precision,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'matched', 'cancelled', 'expired')),
  matched_publication_id uuid REFERENCES public.commute_publications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_waitlist_user_day_dir UNIQUE (user_id, travel_date, direction)
);

CREATE INDEX IF NOT EXISTS idx_commute_waitlist_open
  ON public.commute_waitlist (society_id, travel_date, direction)
  WHERE status = 'open';

ALTER TABLE public.commute_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_waitlist_own ON public.commute_waitlist;
CREATE POLICY commute_waitlist_own ON public.commute_waitlist
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Society meetup points
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.society_meetup_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  label text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  kind text NOT NULL DEFAULT 'gate'
    CHECK (kind IN ('gate', 'clubhouse', 'main_road', 'parking', 'other')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_society_meetup_points_society
  ON public.society_meetup_points (society_id)
  WHERE is_active;

ALTER TABLE public.society_meetup_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS society_meetup_points_read ON public.society_meetup_points;
CREATE POLICY society_meetup_points_read ON public.society_meetup_points
  FOR SELECT TO authenticated
  USING (
    society_id = public.get_user_society_id(auth.uid())
    OR society_id = ANY (public.cleaner_city_allowed_society_ids(auth.uid()))
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS society_meetup_points_admin_write ON public.society_meetup_points;
CREATE POLICY society_meetup_points_admin_write ON public.society_meetup_points
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_society_admin(auth.uid(), society_id))
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_society_admin(auth.uid(), society_id));

-- ---------------------------------------------------------------------------
-- Emergency contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commute_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  phone text,
  notify_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_emergency_contacts_name_len CHECK (char_length(trim(contact_name)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_commute_emergency_contacts_user
  ON public.commute_emergency_contacts (user_id);

ALTER TABLE public.commute_emergency_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_emergency_contacts_own ON public.commute_emergency_contacts;
CREATE POLICY commute_emergency_contacts_own ON public.commute_emergency_contacts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Quick ride messages (capped phrases)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ride_quick_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phrase_key text NOT NULL
    CHECK (phrase_key IN ('here', 'five_late', 'wrong_gate', 'coming', 'wait')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ride_quick_messages_ride
  ON public.ride_quick_messages (ride_id, created_at DESC);

ALTER TABLE public.ride_quick_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ride_quick_messages_participants ON public.ride_quick_messages;
CREATE POLICY ride_quick_messages_participants ON public.ride_quick_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND (r.host_user_id = auth.uid() OR r.guest_user_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Trusted circles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commute_circles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  invite_code text NOT NULL DEFAULT encode(extensions.gen_random_bytes(6), 'hex'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commute_circles_name_len CHECK (char_length(trim(name)) BETWEEN 2 AND 60),
  CONSTRAINT commute_circles_invite_unique UNIQUE (invite_code)
);

CREATE TABLE IF NOT EXISTS public.commute_circle_members (
  circle_id uuid NOT NULL REFERENCES public.commute_circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_commute_circle_members_user
  ON public.commute_circle_members (user_id);

ALTER TABLE public.commute_circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commute_circle_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commute_circles_read ON public.commute_circles;
CREATE POLICY commute_circles_read ON public.commute_circles
  FOR SELECT TO authenticated
  USING (
    society_id = public.get_user_society_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.commute_circle_members m
      WHERE m.circle_id = id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS commute_circle_members_read ON public.commute_circle_members;
CREATE POLICY commute_circle_members_read ON public.commute_circle_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.commute_circle_members m2
      WHERE m2.circle_id = commute_circle_members.circle_id AND m2.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Effective schedule: include pickup coords
-- ---------------------------------------------------------------------------
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
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_user_id IS NULL THEN
    p_user_id := v_caller;
  END IF;

  IF p_user_id <> v_caller
     AND NOT public.is_admin(v_caller)
     AND NOT public.is_society_admin(v_caller, public.get_user_society_id(p_user_id)) THEN
    RAISE EXCEPTION 'Not allowed to read this schedule';
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

-- ---------------------------------------------------------------------------
-- Fuel estimate helper (INR paise) - ledger estimate only, not a fare
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_estimate_fuel_paise(
  p_distance_meters double precision,
  p_seats integer DEFAULT 2
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_km double precision;
  v_rupees numeric;
  v_share numeric;
BEGIN
  IF p_distance_meters IS NULL OR p_distance_meters <= 0 THEN
    RETURN NULL;
  END IF;
  v_km := p_distance_meters / 1000.0;
  -- ~Rs 8/km petrol proxy for shared car; split across seats (host+guests)
  v_rupees := v_km * 8.0;
  v_share := v_rupees / greatest(COALESCE(p_seats, 2), 2);
  RETURN greatest(1000, least(50000, round(v_share * 100)::integer));
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_estimate_fuel_paise(double precision, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_estimate_fuel_paise(double precision, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Autopilot settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_set_autopilot(
  p_enabled boolean,
  p_confirm_mode text DEFAULT 'confirm'
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
  IF p_confirm_mode IS NULL OR p_confirm_mode NOT IN ('confirm', 'auto') THEN
    RAISE EXCEPTION 'confirm_mode must be confirm or auto';
  END IF;
  UPDATE public.commute_profiles
  SET autopilot_enabled = COALESCE(p_enabled, false),
      autopilot_confirm_mode = p_confirm_mode,
      updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_autopilot(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_autopilot(boolean, text) TO authenticated;

-- Draft/publish tomorrow (or p_date) for autopilot hosts
CREATE OR REPLACE FUNCTION public.cleaner_city_autopilot_run(
  p_date date DEFAULT ((timezone('Asia/Kolkata', now()))::date + 1)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_skipped integer := 0;
  r record;
  v_sched jsonb;
  v_vehicle uuid;
  v_office record;
  v_depart time;
  v_status text;
  v_pub public.commute_publications;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_dest_lat double precision;
  v_dest_lng double precision;
BEGIN
  -- Callable by service_role cron or admin
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  FOR r IN
    SELECT cp.*
    FROM public.commute_profiles cp
    WHERE cp.deleted_at IS NULL
      AND cp.is_paused = false
      AND cp.autopilot_enabled = true
      AND cp.role IN ('host', 'both')
  LOOP
    BEGIN
      v_sched := public.cleaner_city_effective_schedule(r.user_id, p_date);
      IF NOT COALESCE((v_sched->>'is_working')::boolean, false) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      SELECT v.id INTO v_vehicle
      FROM public.vehicles v
      WHERE v.user_id = r.user_id AND v.is_active = true
      ORDER BY v.updated_at DESC
      LIMIT 1;
      IF v_vehicle IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      SELECT * INTO v_office
      FROM public.office_locations o
      WHERE o.user_id = r.user_id
      ORDER BY o.is_primary DESC, o.updated_at DESC
      LIMIT 1;

      v_origin_lat := (v_sched->>'pickup_latitude')::double precision;
      v_origin_lng := (v_sched->>'pickup_longitude')::double precision;
      IF v_origin_lat IS NULL OR v_origin_lng IS NULL OR v_office.id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_depart := COALESCE((v_sched->>'depart_time')::time, time '08:30');
      v_dest_lat := v_office.latitude;
      v_dest_lng := v_office.longitude;

      IF EXISTS (
        SELECT 1 FROM public.commute_publications p
        WHERE p.host_user_id = r.user_id
          AND p.travel_date = p_date
          AND p.direction = 'to_office'
          AND p.status IN ('draft', 'published', 'full')
      ) THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_status := CASE WHEN r.autopilot_confirm_mode = 'auto' THEN 'published' ELSE 'draft' END;

      INSERT INTO public.commute_publications (
        host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
        seats_available, seats_total, status,
        origin_latitude, origin_longitude, destination_latitude, destination_longitude,
        origin_label, destination_label, updated_at
      )
      SELECT
        r.user_id, r.society_id, v_vehicle, p_date, 'to_office', v_depart,
        v.seat_capacity, v.seat_capacity, v_status,
        v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
        COALESCE(v_sched->>'pickup_label', 'Pickup'),
        COALESCE(v_office.label, 'Office'),
        now()
      FROM public.vehicles v WHERE v.id = v_vehicle
      RETURNING * INTO v_pub;

      PERFORM public.cleaner_city_enqueue_notify(
        r.user_id,
        CASE WHEN v_status = 'draft' THEN 'Confirm tomorrow commute' ELSE 'Autopilot published seats' END,
        CASE WHEN v_status = 'draft'
          THEN 'Your seats for tomorrow are drafted. Confirm or skip in A Cleaner City.'
          ELSE 'Your seats for tomorrow are live for neighbours.'
        END,
        'cleaner_city_ride_update',
        NULL,
        r.society_id,
        'cc_autopilot_' || r.user_id::text || '_' || p_date::text
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'created', v_count, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_autopilot_run(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_autopilot_run(date) TO service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_confirm_publication(
  p_publication_id uuid,
  p_confirm boolean DEFAULT true
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
  SELECT * INTO v_row FROM public.commute_publications WHERE id = p_publication_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Publication not found';
  END IF;
  IF p_confirm THEN
    IF v_row.status <> 'draft' THEN
      RAISE EXCEPTION 'Only drafts can be confirmed';
    END IF;
    IF v_row.origin_latitude IS NULL OR v_row.destination_latitude IS NULL THEN
      RAISE EXCEPTION 'Set pickup and office pins before confirming';
    END IF;
    UPDATE public.commute_publications
    SET status = 'published', updated_at = now()
    WHERE id = p_publication_id
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.commute_publications
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_publication_id
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_confirm_publication(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_confirm_publication(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Waitlist RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_join_waitlist(
  p_date date,
  p_direction text DEFAULT 'to_office',
  p_depart_time time DEFAULT NULL,
  p_pickup_lat double precision DEFAULT NULL,
  p_pickup_lng double precision DEFAULT NULL,
  p_dest_lat double precision DEFAULT NULL,
  p_dest_lng double precision DEFAULT NULL
)
RETURNS public.commute_waitlist
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.commute_waitlist;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  IF p_date IS NULL OR p_date < (timezone('Asia/Kolkata', now()))::date THEN
    RAISE EXCEPTION 'date must be today or later';
  END IF;
  IF p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'invalid direction';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'Pickup pin required to join waitlist';
  END IF;

  INSERT INTO public.commute_waitlist AS w (
    user_id, society_id, travel_date, direction, depart_time,
    pickup_latitude, pickup_longitude, dest_latitude, dest_longitude,
    status, updated_at
  ) VALUES (
    v_uid, v_society, p_date, p_direction, p_depart_time,
    p_pickup_lat, p_pickup_lng, p_dest_lat, p_dest_lng,
    'open', now()
  )
  ON CONFLICT (user_id, travel_date, direction) DO UPDATE
  SET depart_time = EXCLUDED.depart_time,
      pickup_latitude = EXCLUDED.pickup_latitude,
      pickup_longitude = EXCLUDED.pickup_longitude,
      dest_latitude = EXCLUDED.dest_latitude,
      dest_longitude = EXCLUDED.dest_longitude,
      status = 'open',
      matched_publication_id = NULL,
      updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_join_waitlist(
  date, text, time, double precision, double precision, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_join_waitlist(
  date, text, time, double precision, double precision, double precision, double precision
) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_leave_waitlist(
  p_date date,
  p_direction text DEFAULT 'to_office'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.commute_waitlist
  SET status = 'cancelled', updated_at = now()
  WHERE user_id = auth.uid() AND travel_date = p_date AND direction = p_direction AND status = 'open';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_leave_waitlist(date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_leave_waitlist(date, text) TO authenticated;

-- Notify waitlist when a publication goes live (hook from confirm/publish path via helper)
CREATE OR REPLACE FUNCTION public.cleaner_city_notify_waitlist_for_publication(
  p_publication_id uuid
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
BEGIN
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id;
  IF v_pub.id IS NULL OR v_pub.status <> 'published' THEN
    RETURN 0;
  END IF;

  FOR w IN
    SELECT * FROM public.commute_waitlist
    WHERE status = 'open'
      AND travel_date = v_pub.travel_date
      AND direction = v_pub.direction
      AND user_id <> v_pub.host_user_id
      AND society_id = ANY (
        SELECT unnest(public.cleaner_city_allowed_society_ids(user_id))
      )
    ORDER BY created_at
    LIMIT 20
  LOOP
    -- society scope: publication society must be allowed for waitlist user
    IF v_pub.society_id = ANY (public.cleaner_city_allowed_society_ids(w.user_id)) THEN
      PERFORM public.cleaner_city_enqueue_notify(
        w.user_id,
        'Seat opened on your corridor',
        'A neighbour published seats for your waitlisted commute. Open Find a ride.',
        'cleaner_city_ride_update',
        NULL,
        w.society_id,
        'cc_waitlist_' || w.id::text || '_' || p_publication_id::text
      );
      UPDATE public.commute_waitlist
      SET status = 'matched', matched_publication_id = p_publication_id, updated_at = now()
      WHERE id = w.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_notify_waitlist_for_publication(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_notify_waitlist_for_publication(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- No-show + timeouts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_mark_no_show(
  p_ride_id uuid,
  p_note text DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_other uuid;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending') THEN
    RAISE EXCEPTION 'No-show only from confirmed or pickup_pending';
  END IF;

  UPDATE public.rides
  SET status = 'no_show', updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  -- Release seat if publication still open-ish
  UPDATE public.commute_publications p
  SET seats_available = least(p.seats_total, p.seats_available + 1),
      status = CASE WHEN p.status = 'full' THEN 'published' ELSE p.status END,
      updated_at = now()
  WHERE p.id = v_ride.publication_id;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'no_show',
    'pickup_pending', 'no_show',
    jsonb_build_object('note', p_note)
  );

  INSERT INTO public.ride_incidents (
    ride_id, society_id, reporter_user_id, incident_type, severity, note, status, updated_at
  ) VALUES (
    v_ride.id, v_ride.society_id, v_uid, 'no_show', 'medium',
    NULLIF(trim(COALESCE(p_note, '')), ''), 'open', now()
  );

  v_other := CASE WHEN v_ride.host_user_id = v_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END;
  PERFORM public.cleaner_city_enqueue_notify(
    v_other,
    'Commute marked no-show',
    'Your partner marked this ride as a no-show. Open the app for alternatives.',
    'cleaner_city_ride_update',
    v_ride.id,
    v_ride.society_id,
    'cc_noshow_' || v_ride.id::text
  );

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_mark_no_show(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_mark_no_show(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_process_timeouts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req integer := 0;
  v_pick integer := 0;
  r record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Unanswered requests older than 3 hours
  FOR r IN
    SELECT * FROM public.rides
    WHERE status = 'requested'
      AND created_at < now() - interval '3 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.rides SET status = 'rejected', updated_at = now() WHERE id = r.id;
    UPDATE public.commute_publications p
    SET seats_available = least(p.seats_total, p.seats_available + 1),
        status = CASE WHEN p.status = 'full' THEN 'published' ELSE p.status END,
        updated_at = now()
    WHERE p.id = r.publication_id;
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

  -- Pickup pending past deadline (depart + 30 min) or 45 min after confirm
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
    UPDATE public.commute_publications p
    SET seats_available = least(p.seats_total, p.seats_available + 1),
        status = CASE WHEN p.status = 'full' THEN 'published' ELSE p.status END,
        updated_at = now()
    WHERE p.id = r.publication_id;
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

  RETURN jsonb_build_object('expired_requests', v_req, 'pickup_no_shows', v_pick);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_process_timeouts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_process_timeouts() TO service_role;

-- Cancel recovery suggestions
CREATE OR REPLACE FUNCTION public.cleaner_city_suggest_replacements(
  p_ride_id uuid
)
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
  v_matches jsonb;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.guest_user_id <> v_uid AND v_ride.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id;

  v_matches := public.cleaner_city_find_matches(
    v_ride.travel_date,
    COALESCE(v_pub.direction, 'to_office'),
    v_pub.depart_time,
    v_ride.guest_pickup_latitude,
    v_ride.guest_pickup_longitude,
    v_ride.guest_dest_latitude,
    v_ride.guest_dest_longitude
  );

  RETURN jsonb_build_object(
    'ride_id', p_ride_id,
    'alternatives', COALESCE(v_matches->'matches', '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_suggest_replacements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_suggest_replacements(uuid) TO authenticated;
