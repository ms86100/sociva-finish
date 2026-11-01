-- Cleaner City Phase 1 critical remediation
-- Security: publication coords RLS, circle invite privacy, SOS honesty, publish pin validation
-- Journey: cancel cascade, waitlist on seat free, double-book guard, autopilot hardening
-- Matching honesty is handled in app copy (Approach B). No fabricated coordinates.

-- ---------------------------------------------------------------------------
-- 1) Publication coordinate exposure - society peers cannot SELECT full rows
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS commute_publications_select ON public.commute_publications;
CREATE POLICY commute_publications_select ON public.commute_publications
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR host_user_id = auth.uid()
  );

COMMENT ON POLICY commute_publications_select ON public.commute_publications IS
  'Phase1: host/admin only. Discovery must use cleaner_city_find_matches (no exact coords).';

-- ---------------------------------------------------------------------------
-- 2) Circles - members-only read; invite expiry; leave/remove; society gate
-- ---------------------------------------------------------------------------
ALTER TABLE public.commute_circles
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_revoked_at timestamptz;

UPDATE public.commute_circles
SET invite_expires_at = COALESCE(invite_expires_at, created_at + interval '14 days')
WHERE invite_expires_at IS NULL AND is_active;

DROP POLICY IF EXISTS commute_circles_read ON public.commute_circles;
CREATE POLICY commute_circles_read ON public.commute_circles
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.commute_circle_members m
      WHERE m.circle_id = id AND m.user_id = auth.uid()
    )
  );

COMMENT ON POLICY commute_circles_read ON public.commute_circles IS
  'Phase1: members/admin only - invite_code no longer society-wide readable.';

CREATE OR REPLACE FUNCTION public.cleaner_city_create_circle(
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS public.commute_circles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.commute_circles;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Circle name required';
  END IF;

  INSERT INTO public.commute_circles (
    society_id, name, description, created_by, invite_expires_at
  )
  VALUES (
    v_society,
    trim(p_name),
    NULLIF(trim(COALESCE(p_description, '')), ''),
    v_uid,
    now() + interval '14 days'
  )
  RETURNING * INTO v_row;

  INSERT INTO public.commute_circle_members (circle_id, user_id, role)
  VALUES (v_row.id, v_uid, 'owner');

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_join_circle(p_invite_code text)
RETURNS public.commute_circle_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_circle public.commute_circles;
  v_row public.commute_circle_members;
  v_code text := trim(COALESCE(p_invite_code, ''));
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  IF v_code = '' THEN
    RAISE EXCEPTION 'Invite code required';
  END IF;

  SELECT * INTO v_circle
  FROM public.commute_circles
  WHERE is_active
    AND invite_revoked_at IS NULL
    AND (
      invite_code = v_code
      OR invite_code = lower(v_code)
    )
  LIMIT 1;

  IF v_circle.id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;
  IF v_circle.invite_expires_at IS NOT NULL AND v_circle.invite_expires_at < now() THEN
    RAISE EXCEPTION 'Invite code expired';
  END IF;

  -- Society / neighbour eligibility (never city-wide open join)
  IF NOT (
    v_circle.society_id = public.get_user_society_id(v_uid)
    OR v_circle.society_id = ANY (public.cleaner_city_allowed_society_ids(v_uid))
  ) THEN
    RAISE EXCEPTION 'Circle is outside your society match scope';
  END IF;

  INSERT INTO public.commute_circle_members (circle_id, user_id, role)
  VALUES (v_circle.id, v_uid, 'member')
  ON CONFLICT (circle_id, user_id) DO UPDATE
    SET role = public.commute_circle_members.role
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_leave_circle(p_circle_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_owners integer;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT role INTO v_role
  FROM public.commute_circle_members
  WHERE circle_id = p_circle_id AND user_id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not a circle member';
  END IF;

  IF v_role = 'owner' THEN
    SELECT count(*) INTO v_owners
    FROM public.commute_circle_members
    WHERE circle_id = p_circle_id AND role = 'owner';
    IF v_owners <= 1 THEN
      RAISE EXCEPTION 'Transfer ownership or deactivate the circle before the last owner leaves';
    END IF;
  END IF;

  DELETE FROM public.commute_circle_members
  WHERE circle_id = p_circle_id AND user_id = v_uid;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_leave_circle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_leave_circle(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_remove_circle_member(
  p_circle_id uuid,
  p_member_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_target text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT role INTO v_role
  FROM public.commute_circle_members
  WHERE circle_id = p_circle_id AND user_id = v_uid;
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only circle owners can remove members';
  END IF;
  IF p_member_user_id = v_uid THEN
    RAISE EXCEPTION 'Use leave_circle to leave';
  END IF;
  SELECT role INTO v_target
  FROM public.commute_circle_members
  WHERE circle_id = p_circle_id AND user_id = p_member_user_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_target = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove another owner';
  END IF;
  DELETE FROM public.commute_circle_members
  WHERE circle_id = p_circle_id AND user_id = p_member_user_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_remove_circle_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_remove_circle_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_rotate_circle_invite(p_circle_id uuid)
RETURNS public.commute_circles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_row public.commute_circles;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT role INTO v_role
  FROM public.commute_circle_members
  WHERE circle_id = p_circle_id AND user_id = v_uid;
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can rotate invite codes';
  END IF;

  UPDATE public.commute_circles
  SET invite_code = encode(extensions.gen_random_bytes(6), 'hex'),
      invite_expires_at = now() + interval '14 days',
      invite_revoked_at = NULL,
      updated_at = now()
  WHERE id = p_circle_id AND is_active
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Circle not found';
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_rotate_circle_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_rotate_circle_invite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_my_circles()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'description', c.description,
      'role', m.role,
      'member_count', (SELECT count(*) FROM public.commute_circle_members x WHERE x.circle_id = c.id),
      'invite_code', CASE WHEN m.role = 'owner' THEN c.invite_code ELSE NULL END,
      'invite_expires_at', CASE WHEN m.role = 'owner' THEN c.invite_expires_at ELSE NULL END,
      'invite_expired', CASE
        WHEN m.role = 'owner' AND c.invite_expires_at IS NOT NULL AND c.invite_expires_at < now() THEN true
        WHEN m.role = 'owner' THEN false
        ELSE NULL
      END
    ) ORDER BY c.name)
    FROM public.commute_circle_members m
    JOIN public.commute_circles c ON c.id = m.circle_id AND c.is_active
    WHERE m.user_id = auth.uid()
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_list_circle_members(p_circle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.commute_circle_members
    WHERE circle_id = p_circle_id AND user_id = v_uid
  ) AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not a circle member';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'role', m.role,
      'joined_at', m.joined_at,
      'display_name', COALESCE(p.name, 'Member')
    ) ORDER BY m.role DESC, m.joined_at)
    FROM public.commute_circle_members m
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.circle_id = p_circle_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_list_circle_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_list_circle_members(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) SOS honesty - resolve Sociva contacts by phone; return fan-out counts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_resolve_emergency_notify_user(p_phone text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_phone text;
  v_found uuid;
  v_society uuid;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  v_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9+]', '', 'g');
  IF length(v_phone) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT p.id, p.society_id INTO v_found, v_society
  FROM public.profiles p
  WHERE p.phone IS NOT NULL
    AND p.phone <> ''
    AND (
      regexp_replace(p.phone, '[^0-9+]', '', 'g') = v_phone
      OR right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 10)
    )
    AND p.id <> v_uid
  ORDER BY p.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_found IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_society IS NULL OR NOT (
    v_society = public.get_user_society_id(v_uid)
    OR v_society = ANY (public.cleaner_city_allowed_society_ids(v_uid))
  ) THEN
    RETURN NULL;
  END IF;

  RETURN v_found;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_resolve_emergency_notify_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_resolve_emergency_notify_user(text) TO authenticated;

DROP FUNCTION IF EXISTS public.cleaner_city_report_incident(
  uuid, text, text, double precision, double precision, text
);

CREATE OR REPLACE FUNCTION public.cleaner_city_report_incident(
  p_ride_id uuid,
  p_incident_type text,
  p_note text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_severity text DEFAULT 'high'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_row public.ride_incidents;
  v_other uuid;
  c record;
  v_share public.ride_share_tokens;
  v_contact_notified integer := 0;
  v_phone_only_skipped integer := 0;
  v_admin_notified integer := 0;
  v_admin record;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
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

  IF v_other IS NOT NULL THEN
    PERFORM public.cleaner_city_enqueue_notify(
      v_other,
      CASE WHEN p_incident_type = 'sos' THEN 'SOS on your commute' ELSE 'Safety report on ride' END,
      'A participant reported a safety issue. Open the ride for details.',
      'cleaner_city_safety',
      p_ride_id,
      v_ride.society_id,
      'cc_safety_' || v_row.id::text
    );
  END IF;

  IF p_incident_type = 'sos' THEN
    BEGIN
      SELECT * INTO v_share FROM public.cleaner_city_create_share_token(p_ride_id);
    EXCEPTION WHEN OTHERS THEN
      v_share := NULL;
    END;

    FOR c IN
      SELECT * FROM public.commute_emergency_contacts
      WHERE user_id = v_uid
    LOOP
      IF c.notify_user_id IS NOT NULL THEN
        PERFORM public.cleaner_city_enqueue_notify(
          c.notify_user_id,
          'Emergency: Cleaner City SOS',
          'Your contact triggered SOS on a commute. Open Sociva for the shared ride.',
          'cleaner_city_safety',
          p_ride_id,
          v_ride.society_id,
          'cc_sos_ec_' || v_row.id::text || '_' || c.id::text
        );
        v_contact_notified := v_contact_notified + 1;
      ELSE
        v_phone_only_skipped := v_phone_only_skipped + 1;
      END IF;
    END LOOP;

    -- Society admins (in-app). Not SMS. Not 112.
    FOR v_admin IN
      SELECT DISTINCT p.id AS user_id
      FROM public.profiles p
      WHERE p.society_id = v_ride.society_id
        AND public.is_society_admin(p.id, v_ride.society_id)
        AND p.id <> v_uid
      LIMIT 20
    LOOP
      PERFORM public.cleaner_city_enqueue_notify(
        v_admin.user_id,
        'Cleaner City SOS - admin',
        'A resident triggered SOS. Open Admin Cleaner City incidents.',
        'cleaner_city_safety',
        p_ride_id,
        v_ride.society_id,
        'cc_sos_admin_' || v_row.id::text || '_' || v_admin.user_id::text
      );
      v_admin_notified := v_admin_notified + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'incident_id', v_row.id,
    'incident_type', v_row.incident_type,
    'status', v_row.status,
    'notified_counterpart', v_other IS NOT NULL,
    'notified_contacts', v_contact_notified,
    'notified_admins', v_admin_notified,
    'phone_only_contacts_skipped', v_phone_only_skipped,
    'sms_sent', false,
    'dialed_112', false,
    'share_token_created', v_share.id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_report_incident(
  uuid, text, text, double precision, double precision, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_report_incident(
  uuid, text, text, double precision, double precision, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) Server-side publish pin validation + fill coords from schedule/office
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_publish_commute(
  p_vehicle_id uuid,
  p_travel_date date,
  p_direction text DEFAULT 'to_office',
  p_depart_time time DEFAULT NULL,
  p_seats_available integer DEFAULT NULL,
  p_route_polyline text DEFAULT NULL,
  p_publication_id uuid DEFAULT NULL
)
RETURNS public.commute_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_vehicle public.vehicles;
  v_seats integer;
  v_depart time;
  v_effective jsonb;
  v_row public.commute_publications;
  v_office record;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_dest_lat double precision;
  v_dest_lng double precision;
  v_origin_label text;
  v_dest_label text;
BEGIN
  v_society := public.cleaner_city_assert_host_access(v_uid);

  IF p_travel_date IS NULL OR p_travel_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'travel_date must be today or a future date';
  END IF;

  IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;

  SELECT * INTO v_vehicle
  FROM public.vehicles
  WHERE id = p_vehicle_id AND user_id = v_uid AND is_active = true;

  IF v_vehicle.id IS NULL THEN
    RAISE EXCEPTION 'Active vehicle required to publish a ride';
  END IF;

  v_effective := public.cleaner_city_effective_schedule(v_uid, p_travel_date);
  IF COALESCE((v_effective->>'is_paused')::boolean, false) THEN
    RAISE EXCEPTION 'Commute is paused - resume before publishing';
  END IF;
  IF NOT COALESCE((v_effective->>'is_working')::boolean, false) THEN
    RAISE EXCEPTION 'Not commuting on this date - update schedule or override first';
  END IF;

  SELECT * INTO v_office
  FROM public.office_locations o
  WHERE o.user_id = v_uid
  ORDER BY o.is_primary DESC, o.updated_at DESC
  LIMIT 1;

  IF v_office.id IS NULL
     OR v_office.latitude IS NULL OR v_office.longitude IS NULL
     OR v_office.latitude < -90 OR v_office.latitude > 90
     OR v_office.longitude < -180 OR v_office.longitude > 180 THEN
    RAISE EXCEPTION 'Valid office coordinates required before publishing';
  END IF;

  IF (v_effective->>'pickup_latitude') IS NULL
     OR (v_effective->>'pickup_longitude') IS NULL THEN
    RAISE EXCEPTION 'Valid pickup coordinates required before publishing';
  END IF;

  v_origin_lat := (v_effective->>'pickup_latitude')::double precision;
  v_origin_lng := (v_effective->>'pickup_longitude')::double precision;
  IF v_origin_lat < -90 OR v_origin_lat > 90 OR v_origin_lng < -180 OR v_origin_lng > 180 THEN
    RAISE EXCEPTION 'Pickup coordinates out of range';
  END IF;

  IF p_direction = 'to_office' THEN
    v_depart := COALESCE(p_depart_time, (v_effective->>'depart_time')::time);
    v_dest_lat := v_office.latitude;
    v_dest_lng := v_office.longitude;
    v_origin_label := COALESCE(v_effective->>'pickup_label', 'Pickup');
    v_dest_label := COALESCE(v_office.label, 'Office');
  ELSE
    v_depart := COALESCE(p_depart_time, (v_effective->>'return_time')::time);
    -- Swap: origin is office, destination is home pickup corridor
    v_dest_lat := v_origin_lat;
    v_dest_lng := v_origin_lng;
    v_origin_lat := v_office.latitude;
    v_origin_lng := v_office.longitude;
    v_origin_label := COALESCE(v_office.label, 'Office');
    v_dest_label := COALESCE(v_effective->>'pickup_label', 'Home');
  END IF;

  IF v_depart IS NULL THEN
    RAISE EXCEPTION 'depart_time required to publish';
  END IF;

  v_seats := COALESCE(p_seats_available, v_vehicle.seat_capacity);
  IF v_seats IS NULL OR v_seats < 1 THEN
    RAISE EXCEPTION 'seats_available must be at least 1';
  END IF;
  IF v_seats > v_vehicle.seat_capacity THEN
    RAISE EXCEPTION 'Cannot publish more seats than vehicle capacity';
  END IF;
  IF v_vehicle.vehicle_type = 'bike' AND v_seats > 1 THEN
    RAISE EXCEPTION 'Bike publications cannot offer more than 1 passenger seat';
  END IF;

  IF p_publication_id IS NOT NULL THEN
    UPDATE public.commute_publications p
    SET
      vehicle_id = p_vehicle_id,
      travel_date = p_travel_date,
      direction = p_direction,
      depart_time = v_depart,
      seats_available = v_seats,
      seats_total = v_vehicle.seat_capacity,
      route_polyline = COALESCE(NULLIF(trim(COALESCE(p_route_polyline, '')), ''), p.route_polyline),
      origin_latitude = v_origin_lat,
      origin_longitude = v_origin_lng,
      destination_latitude = v_dest_lat,
      destination_longitude = v_dest_lng,
      origin_label = v_origin_label,
      destination_label = v_dest_label,
      status = 'published',
      society_id = v_society,
      updated_at = now()
    WHERE p.id = p_publication_id
      AND p.host_user_id = v_uid
      AND p.status IN ('draft', 'published')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Publication not found or not editable';
    END IF;
    PERFORM public.cleaner_city_notify_waitlist_for_publication(v_row.id, true);
    RETURN v_row;
  END IF;

  UPDATE public.commute_publications
  SET status = 'cancelled', updated_at = now()
  WHERE host_user_id = v_uid
    AND travel_date = p_travel_date
    AND direction = p_direction
    AND status IN ('draft', 'published');

  INSERT INTO public.commute_publications (
    host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
    seats_available, seats_total, status, route_polyline,
    origin_latitude, origin_longitude, destination_latitude, destination_longitude,
    origin_label, destination_label, updated_at
  )
  VALUES (
    v_uid, v_society, p_vehicle_id, p_travel_date, p_direction, v_depart,
    v_seats, v_vehicle.seat_capacity, 'published',
    NULLIF(trim(COALESCE(p_route_polyline, '')), ''),
    v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
    v_origin_label, v_dest_label, now()
  )
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_notify_waitlist_for_publication(v_row.id, true);
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Waitlist notify - blocks, soft route, optional mark_matched
-- ---------------------------------------------------------------------------
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
BEGIN
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id;
  IF v_pub.id IS NULL OR v_pub.status NOT IN ('published', 'full') THEN
    RETURN 0;
  END IF;
  IF v_pub.seats_available < 1 AND v_pub.status = 'full' THEN
    RETURN 0;
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

    -- Soft corridor filter when both sides have pickup coords (~5km)
    IF w.pickup_latitude IS NOT NULL
       AND v_pub.origin_latitude IS NOT NULL
       AND w.pickup_longitude IS NOT NULL
       AND v_pub.origin_longitude IS NOT NULL THEN
      v_dist := public.cleaner_city_haversine_meters(
        w.pickup_latitude, w.pickup_longitude,
        v_pub.origin_latitude, v_pub.origin_longitude
      );
      IF v_dist > 5000 THEN
        CONTINUE;
      END IF;
    END IF;

    PERFORM public.cleaner_city_enqueue_notify(
      w.user_id,
      'Seat opened on your corridor',
      'A neighbour has an open seat for your waitlisted commute. This is not a reserved seat - open Find a ride to request.',
      'cleaner_city_ride_update',
      NULL,
      w.society_id,
      'cc_waitlist_' || w.id::text || '_' || p_publication_id::text || '_' || CASE WHEN p_mark_matched THEN 'pub' ELSE 'seat' END
    );

    IF p_mark_matched THEN
      UPDATE public.commute_waitlist
      SET status = 'matched', matched_publication_id = p_publication_id, updated_at = now()
      WHERE id = w.id AND status = 'open';
    END IF;

    v_count := v_count + 1;
    IF v_count >= 20 THEN
      EXIT;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_notify_waitlist_for_publication(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleaner_city_notify_waitlist_for_publication(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_notify_waitlist_for_publication(uuid, boolean) TO authenticated, service_role;
-- Keep single-arg overload for older callers
CREATE OR REPLACE FUNCTION public.cleaner_city_notify_waitlist_for_publication(p_publication_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cleaner_city_notify_waitlist_for_publication(p_publication_id, false);
$$;
GRANT EXECUTE ON FUNCTION public.cleaner_city_notify_waitlist_for_publication(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_release_publication_seat(p_publication_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub public.commute_publications;
BEGIN
  SELECT * INTO v_pub FROM public.commute_publications WHERE id = p_publication_id FOR UPDATE;
  IF v_pub.id IS NULL THEN
    RETURN;
  END IF;
  IF v_pub.status NOT IN ('published', 'full') THEN
    RETURN;
  END IF;

  UPDATE public.commute_publications
  SET seats_available = least(seats_total, seats_available + 1),
      status = 'published',
      updated_at = now()
  WHERE id = p_publication_id;

  PERFORM public.cleaner_city_notify_waitlist_for_publication(p_publication_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_release_publication_seat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_release_publication_seat(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Publication cancel cascade + guest notify
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cleaner_city_cancel_publication(uuid);

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
            || ' Open Find a ride for alternatives.',
          'Your host cancelled this commute. Open Find a ride for alternatives.'
        ),
        'cleaner_city_ride_update',
        r.id,
        r.society_id,
        'cc_pub_cancel_' || p_publication_id::text || '_' || r.id::text
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

-- ---------------------------------------------------------------------------
-- 7) Seat-release paths call waitlist notify
-- ---------------------------------------------------------------------------
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

  RETURN v_ride;
END;
$$;

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

  IF v_ride.publication_id IS NOT NULL THEN
    PERFORM public.cleaner_city_release_publication_seat(v_ride.publication_id);
  END IF;

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
  IF v_other IS NOT NULL THEN
    PERFORM public.cleaner_city_enqueue_notify(
      v_other,
      'Commute marked no-show',
      'Your partner marked this ride as a no-show. Open the app for alternatives.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_noshow_' || v_ride.id::text
    );
  END IF;

  RETURN v_ride;
END;
$$;

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

  RETURN jsonb_build_object('expired_requests', v_req, 'pickup_no_shows', v_pick);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8) Guest double-booking protection (same date + direction)
-- ---------------------------------------------------------------------------
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

  IF EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.publication_id = p_publication_id
      AND r.guest_user_id = v_uid
      AND r.status IN ('requested', 'confirmed', 'pickup_pending', 'started')
  ) THEN
    RAISE EXCEPTION 'You already have an open request for this ride';
  END IF;

  -- Cross-publication same day + direction
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

-- ---------------------------------------------------------------------------
-- 9) Autopilot hardening
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_commute_publications_host_date_dir_active
  ON public.commute_publications (host_user_id, travel_date, direction)
  WHERE status IN ('draft', 'published', 'full');

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

  IF NOT COALESCE(p_enabled, false) THEN
    UPDATE public.commute_publications
    SET status = 'cancelled', updated_at = now()
    WHERE host_user_id = v_uid
      AND status = 'draft'
      AND travel_date >= (timezone('Asia/Kolkata', now()))::date;
  END IF;

  RETURN v_row;
END;
$$;

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
      AND public.cleaner_city_is_work_email_verified(cp.user_id)
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
      IF v_origin_lat < -90 OR v_origin_lat > 90 OR v_origin_lng < -180 OR v_origin_lng > 180 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_depart := COALESCE((v_sched->>'depart_time')::time, time '08:30');
      v_dest_lat := v_office.latitude;
      v_dest_lng := v_office.longitude;

      -- Do not recreate after host cancelled that day, or if active draft/published exists
      IF EXISTS (
        SELECT 1 FROM public.commute_publications p
        WHERE p.host_user_id = r.user_id
          AND p.travel_date = p_date
          AND p.direction = 'to_office'
          AND p.status IN ('draft', 'published', 'full', 'cancelled')
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

      IF v_pub.id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_status = 'published' THEN
        PERFORM public.cleaner_city_notify_waitlist_for_publication(v_pub.id, true);
      END IF;

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
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('date', p_date, 'created', v_count, 'skipped', v_skipped);
END;
$$;

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
    IF v_row.origin_latitude IS NULL OR v_row.destination_latitude IS NULL
       OR v_row.origin_longitude IS NULL OR v_row.destination_longitude IS NULL THEN
      RAISE EXCEPTION 'Set pickup and office pins before confirming';
    END IF;
    UPDATE public.commute_publications
    SET status = 'published', updated_at = now()
    WHERE id = p_publication_id
    RETURNING * INTO v_row;
    PERFORM public.cleaner_city_notify_waitlist_for_publication(v_row.id, true);
  ELSE
    UPDATE public.commute_publications
    SET status = 'cancelled', updated_at = now()
    WHERE id = p_publication_id
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10) Respond reject also releases via helper
-- ---------------------------------------------------------------------------
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
  v_deadline timestamptz;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN RAISE EXCEPTION 'Ride not found'; END IF;
  IF v_ride.host_user_id <> v_uid THEN RAISE EXCEPTION 'Only host can respond'; END IF;
  IF v_ride.status <> 'requested' THEN RAISE EXCEPTION 'Ride is not awaiting response'; END IF;

  SELECT * INTO v_pub FROM public.commute_publications WHERE id = v_ride.publication_id;

  IF p_accept THEN
    v_deadline := (v_ride.travel_date + COALESCE(v_pub.depart_time, time '08:30'))
      AT TIME ZONE 'Asia/Kolkata' + interval '30 minutes';
    UPDATE public.rides
    SET status = 'confirmed',
        pickup_deadline_at = v_deadline,
        updated_at = now()
    WHERE id = p_ride_id
    RETURNING * INTO v_ride;
    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'confirmed', 'requested', 'confirmed', '{}'::jsonb
    );
    PERFORM public.cleaner_city_enqueue_notify(
      v_ride.guest_user_id,
      'Seat confirmed',
      'Your commute seat was accepted. Open the ride for pickup details.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_accept_' || v_ride.id::text
    );
  ELSE
    UPDATE public.rides SET status = 'rejected', updated_at = now() WHERE id = p_ride_id
    RETURNING * INTO v_ride;
    IF v_ride.publication_id IS NOT NULL THEN
      PERFORM public.cleaner_city_release_publication_seat(v_ride.publication_id);
    END IF;
    PERFORM public.cleaner_city_append_ride_event(
      v_ride.id, v_ride.society_id, v_uid, 'rejected', 'requested', 'rejected', '{}'::jsonb
    );
    PERFORM public.cleaner_city_enqueue_notify(
      v_ride.guest_user_id,
      'Seat request declined',
      'Try another match or join the waitlist.',
      'cleaner_city_ride_update',
      v_ride.id,
      v_ride.society_id,
      'cc_reject_' || v_ride.id::text
    );
  END IF;
  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_respond_ride_request(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_respond_ride_request(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_publish_commute IS
  'Phase1: requires verified host + vehicle + valid pickup/office coordinates server-side.';
COMMENT ON FUNCTION public.cleaner_city_cancel_publication IS
  'Phase1: cancels publication and cascades to active guest rides with notify.';
COMMENT ON FUNCTION public.cleaner_city_autopilot_run IS
  'Phase1: re-checks work email, unique active pubs, skips cancelled days.';

-- ---------------------------------------------------------------------------
-- Phase1 privacy selftest (service_role / admin). Callable for regression.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_phase1_privacy_selftest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pub_policy text;
  v_circle_policy text;
  v_has_leave boolean;
  v_has_unique boolean;
  v_publish_has_pin_guard boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT pg_get_expr(polqual, polrelid) INTO v_pub_policy
  FROM pg_policy
  WHERE polrelid = 'public.commute_publications'::regclass
    AND polname = 'commute_publications_select';

  SELECT pg_get_expr(polqual, polrelid) INTO v_circle_policy
  FROM pg_policy
  WHERE polrelid = 'public.commute_circles'::regclass
    AND polname = 'commute_circles_read';

  v_has_leave := EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleaner_city_leave_circle');
  v_has_unique := EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_commute_publications_host_date_dir_active'
  );
  v_publish_has_pin_guard := pg_get_functiondef(
    (SELECT oid FROM pg_proc WHERE proname = 'cleaner_city_publish_commute' ORDER BY oid DESC LIMIT 1)
  ) ILIKE '%Valid pickup coordinates required%';

  RETURN jsonb_build_object(
    'publications_select_blocks_society_peers',
      (v_pub_policy IS NOT NULL AND v_pub_policy NOT ILIKE '%published%' AND v_pub_policy ILIKE '%host_user_id%'),
    'circles_read_members_only',
      (v_circle_policy IS NOT NULL AND v_circle_policy NOT ILIKE '%get_user_society_id%' AND v_circle_policy ILIKE '%commute_circle_members%'),
    'leave_circle_rpc', v_has_leave,
    'unique_active_publication_index', v_has_unique,
    'publish_pin_guard', v_publish_has_pin_guard,
    'invite_expires_column', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='commute_circles' AND column_name='invite_expires_at'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_phase1_privacy_selftest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_phase1_privacy_selftest() TO service_role;
