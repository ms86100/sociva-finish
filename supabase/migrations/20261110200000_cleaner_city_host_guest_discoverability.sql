-- Host + guest discoverability:
-- 1) Host choosers become dual-role (both)
-- 2) Track one-shot default Auto-offer application
-- 3) Autopilot publishes to_office and to_home on working days

ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS autopilot_default_applied boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.commute_profiles.autopilot_default_applied IS
  'True once default Auto-offer was applied or the user toggled Auto-offer; prevents re-forcing on.';

-- Existing host-only profiles can Find and Offer.
UPDATE public.commute_profiles
SET role = 'both',
    updated_at = now()
WHERE deleted_at IS NULL
  AND role = 'host';

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
      autopilot_default_applied = true,
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

CREATE OR REPLACE FUNCTION public.cleaner_city_maybe_enable_default_autopilot()
RETURNS public.commute_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_profiles;
  v_has_vehicle boolean;
  v_has_office boolean;
  v_has_home boolean;
  v_has_week boolean;
  v_has_road boolean;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_row
  FROM public.commute_profiles
  WHERE user_id = v_uid AND deleted_at IS NULL;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required';
  END IF;

  -- Already applied or already on - no-op.
  IF COALESCE(v_row.autopilot_default_applied, false)
     OR COALESCE(v_row.autopilot_enabled, false) THEN
    RETURN v_row;
  END IF;

  IF v_row.role NOT IN ('host', 'both') OR COALESCE(v_row.is_paused, false) THEN
    RETURN v_row;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vehicles v
    WHERE v.user_id = v_uid AND v.is_active = true
  ) INTO v_has_vehicle;

  SELECT EXISTS (
    SELECT 1 FROM public.office_locations o
    WHERE o.user_id = v_uid
      AND o.latitude IS NOT NULL
      AND o.longitude IS NOT NULL
  ) INTO v_has_office;

  SELECT EXISTS (
    SELECT 1 FROM public.commute_templates t
    WHERE t.user_id = v_uid
      AND t.pickup_latitude IS NOT NULL
      AND t.pickup_longitude IS NOT NULL
  ) INTO v_has_home;

  SELECT EXISTS (
    SELECT 1 FROM public.commute_templates t
    WHERE t.user_id = v_uid
      AND t.is_working = true
      AND (t.depart_time IS NOT NULL OR t.return_time IS NOT NULL)
  ) INTO v_has_week;

  v_has_road := NULLIF(trim(COALESCE(v_row.preferred_route_polyline, '')), '') IS NOT NULL;

  IF NOT (v_has_vehicle AND v_has_office AND v_has_home AND v_has_week AND v_has_road) THEN
    RETURN v_row;
  END IF;

  UPDATE public.commute_profiles
  SET autopilot_enabled = true,
      autopilot_confirm_mode = 'auto',
      autopilot_default_applied = true,
      updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_maybe_enable_default_autopilot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_maybe_enable_default_autopilot() TO authenticated;

-- Autopilot: both commute legs on working days.
CREATE OR REPLACE FUNCTION public.cleaner_city_autopilot_run(
  p_date date DEFAULT ((timezone('Asia/Kolkata'::text, now()))::date + 1)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_skipped integer := 0;
  v_drafted integer := 0;
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
  v_poly text;
  v_dist integer;
  v_dur integer;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_dir text;
  v_origin_label text;
  v_dest_label text;
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

      v_pickup_lat := (v_sched->>'pickup_latitude')::double precision;
      v_pickup_lng := (v_sched->>'pickup_longitude')::double precision;
      IF v_pickup_lat IS NULL OR v_pickup_lng IS NULL OR v_office.id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF v_pickup_lat < -90 OR v_pickup_lat > 90 OR v_pickup_lng < -180 OR v_pickup_lng > 180 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      FOREACH v_dir IN ARRAY ARRAY['to_office', 'to_home']
      LOOP
        BEGIN
          IF EXISTS (
            SELECT 1 FROM public.commute_publications p
            WHERE p.host_user_id = r.user_id
              AND p.travel_date = p_date
              AND p.direction = v_dir
              AND p.status IN ('draft', 'published', 'full', 'cancelled')
          ) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
          END IF;

          IF v_dir = 'to_office' THEN
            v_depart := COALESCE((v_sched->>'depart_time')::time, time '08:30');
            v_origin_lat := v_pickup_lat;
            v_origin_lng := v_pickup_lng;
            v_dest_lat := v_office.latitude;
            v_dest_lng := v_office.longitude;
            v_origin_label := COALESCE(v_sched->>'pickup_label', 'Pickup');
            v_dest_label := COALESCE(v_office.label, 'Office');
            v_poly := NULLIF(trim(COALESCE(r.preferred_route_polyline, '')), '');
            v_dist := r.preferred_route_distance_meters;
            v_dur := r.preferred_route_duration_seconds;
          ELSE
            -- Evening leg requires a return time; skip if missing.
            IF (v_sched->>'return_time') IS NULL OR trim(v_sched->>'return_time') = '' THEN
              v_skipped := v_skipped + 1;
              CONTINUE;
            END IF;
            -- Only create to_home when the preferred return road exists.
            IF NULLIF(trim(COALESCE(r.preferred_return_route_polyline, '')), '') IS NULL THEN
              v_skipped := v_skipped + 1;
              CONTINUE;
            END IF;
            v_depart := (v_sched->>'return_time')::time;
            v_origin_lat := v_office.latitude;
            v_origin_lng := v_office.longitude;
            v_dest_lat := v_pickup_lat;
            v_dest_lng := v_pickup_lng;
            v_origin_label := COALESCE(v_office.label, 'Office');
            v_dest_label := COALESCE(v_sched->>'pickup_label', 'Home');
            v_poly := NULLIF(trim(COALESCE(r.preferred_return_route_polyline, '')), '');
            v_dist := r.preferred_return_route_distance_meters;
            v_dur := r.preferred_return_route_duration_seconds;
          END IF;

          v_status := 'draft';
          IF r.autopilot_confirm_mode = 'auto' AND v_poly IS NOT NULL THEN
            BEGIN
              PERFORM public.cleaner_city_assert_publishable_polyline(
                v_poly, v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng, 8, 2500
              );
              v_status := 'published';
            EXCEPTION WHEN OTHERS THEN
              v_status := 'draft';
              v_poly := NULL;
              v_dist := NULL;
              v_dur := NULL;
            END;
          END IF;

          INSERT INTO public.commute_publications (
            host_user_id, society_id, vehicle_id, travel_date, direction, depart_time,
            seats_available, seats_total, status, route_polyline,
            route_distance_meters, route_duration_seconds, route_provider,
            origin_latitude, origin_longitude, destination_latitude, destination_longitude,
            origin_label, destination_label, updated_at
          )
          SELECT
            r.user_id, r.society_id, v_vehicle, p_date, v_dir, v_depart,
            v.seat_capacity, v.seat_capacity, v_status, v_poly,
            v_dist, v_dur, CASE WHEN v_poly IS NOT NULL THEN 'google' ELSE NULL END,
            v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
            v_origin_label,
            v_dest_label,
            now()
          FROM public.vehicles v WHERE v.id = v_vehicle
          RETURNING * INTO v_pub;

          IF v_pub.id IS NULL THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
          END IF;

          IF v_status = 'published' THEN
            PERFORM public.cleaner_city_notify_waitlist_for_publication(v_pub.id, true);
            v_count := v_count + 1;
          ELSE
            v_drafted := v_drafted + 1;
          END IF;

          PERFORM public.cleaner_city_enqueue_notify(
            r.user_id,
            CASE WHEN v_status = 'draft' THEN 'Confirm tomorrow seats' ELSE 'Autopilot published seats' END,
            CASE WHEN v_status = 'draft'
              THEN 'Your Autopilot draft needs a usual road before guests can match. Open Offer to rebuild and confirm.'
              ELSE CASE WHEN v_dir = 'to_home'
                THEN 'Your empty seats are live for tomorrow evening.'
                ELSE 'Your empty seats are live for tomorrow morning.'
              END
            END,
            'cleaner_city_ride_update',
            NULL,
            r.society_id,
            'cc_autopilot_' || r.user_id::text || '_' || p_date::text || '_' || v_dir
          );
        EXCEPTION WHEN unique_violation THEN
          v_skipped := v_skipped + 1;
        WHEN OTHERS THEN
          v_skipped := v_skipped + 1;
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'published', v_count,
    'drafted', v_drafted,
    'skipped', v_skipped,
    'date', p_date
  );
END;
$$;

COMMENT ON FUNCTION public.cleaner_city_autopilot_run IS
  'Creates Autopilot publications for to_office and to_home on working days for hosts with Auto-offer on.';
