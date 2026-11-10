-- Green City go-live hardening:
-- 1) assert polyline quality on publish + confirm
-- 2) autopilot never auto-publishes without preferred dense road
-- 3) fuel snapshot distance backfill before apply
-- 4) seed pilot meetup points
-- 5) expire stale requested rides
-- 6) tighten timeouts cron

-- ---------------------------------------------------------------------------
-- Publish: require assertable corridor geometry
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
  v_poly text;
BEGIN
  v_society := public.cleaner_city_assert_host_access(v_uid);

  IF p_travel_date IS NULL OR p_travel_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'travel_date must be today or a future date';
  END IF;

  IF p_direction IS NULL OR p_direction NOT IN ('to_office', 'to_home') THEN
    RAISE EXCEPTION 'direction must be to_office or to_home';
  END IF;

  v_poly := NULLIF(trim(COALESCE(p_route_polyline, '')), '');
  IF v_poly IS NULL OR length(v_poly) < 10 THEN
    RAISE EXCEPTION 'Driving route polyline is required to publish a ride';
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

  PERFORM public.cleaner_city_assert_publishable_polyline(
    v_poly, v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng, 8, 2500
  );

  IF p_publication_id IS NOT NULL THEN
    UPDATE public.commute_publications p
    SET
      vehicle_id = p_vehicle_id,
      travel_date = p_travel_date,
      direction = p_direction,
      depart_time = v_depart,
      seats_available = v_seats,
      seats_total = v_vehicle.seat_capacity,
      route_polyline = v_poly,
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
    v_poly,
    v_origin_lat, v_origin_lng, v_dest_lat, v_dest_lng,
    v_origin_label, v_dest_label, now()
  )
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_notify_waitlist_for_publication(v_row.id, true);
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Confirm draft → published only with quality polyline
-- ---------------------------------------------------------------------------
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
    PERFORM public.cleaner_city_assert_publishable_polyline(
      v_row.route_polyline,
      v_row.origin_latitude,
      v_row.origin_longitude,
      v_row.destination_latitude,
      v_row.destination_longitude,
      8,
      2500
    );
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
-- Autopilot: preferred road required for auto-publish; else draft + notify
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cleaner_city_autopilot_run(date);

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

      v_poly := NULLIF(trim(COALESCE(r.preferred_route_polyline, '')), '');
      v_dist := r.preferred_route_distance_meters;
      v_dur := r.preferred_route_duration_seconds;

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
        r.user_id, r.society_id, v_vehicle, p_date, 'to_office', v_depart,
        v.seat_capacity, v.seat_capacity, v_status, v_poly,
        v_dist, v_dur, CASE WHEN v_poly IS NOT NULL THEN 'google' ELSE NULL END,
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
        v_count := v_count + 1;
      ELSE
        v_drafted := v_drafted + 1;
      END IF;

      PERFORM public.cleaner_city_enqueue_notify(
        r.user_id,
        CASE WHEN v_status = 'draft' THEN 'Confirm tomorrow seats' ELSE 'Autopilot published seats' END,
        CASE WHEN v_status = 'draft'
          THEN 'Your Autopilot draft needs a usual road before guests can match. Open Offer to rebuild and confirm.'
          ELSE 'Your empty seats are live for tomorrow morning.'
        END,
        'cleaner_city_ride_update',
        NULL,
        r.society_id,
        'cc_autopilot_' || r.user_id::text || '_' || p_date::text
      );
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
    WHEN OTHERS THEN
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

-- ---------------------------------------------------------------------------
-- Fuel: backfill distance from pub / haversine before snapshot apply
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleaner_city_rides_fuel_snapshot_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dist double precision;
  v_olat double precision;
  v_olng double precision;
  v_dlat double precision;
  v_dlng double precision;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('confirmed', 'pickup_pending') THEN
    SELECT
      NULLIF(p.route_distance_meters, 0)::double precision,
      p.origin_latitude,
      p.origin_longitude,
      p.destination_latitude,
      p.destination_longitude
    INTO v_dist, v_olat, v_olng, v_dlat, v_dlng
    FROM public.commute_publications p
    WHERE p.id = NEW.publication_id;

    IF COALESCE(NEW.fuel_distance_meters, 0) <= 0 THEN
      IF v_dist IS NULL OR v_dist <= 0 THEN
        v_dist := public.cleaner_city_haversine_m(v_olat, v_olng, v_dlat, v_dlng);
      END IF;
      IF v_dist IS NOT NULL AND v_dist > 0 THEN
        UPDATE public.rides
        SET fuel_distance_meters = v_dist,
            updated_at = now()
        WHERE id = NEW.id;
      END IF;
    END IF;

    PERFORM public.cleaner_city_apply_fuel_snapshot(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

-- Soft-cancel any published inventory that still fails quality.
UPDATE public.commute_publications p
SET status = 'cancelled', updated_at = now()
WHERE p.status = 'published'
  AND (
    p.route_polyline IS NULL
    OR length(trim(p.route_polyline)) < 50
    OR COALESCE(
         (public.cleaner_city_project_point_on_polyline(
            p.route_polyline, p.origin_latitude, p.origin_longitude, 250
          )->>'distance_m')::double precision,
         1e12
       ) > 2500
  );

-- Expire stale open requests now.
SELECT public.cleaner_city_process_timeouts();

-- Seed meetup points for pilot societies (idempotent by label+society).
INSERT INTO public.society_meetup_points (
  society_id, label, latitude, longitude, kind, is_active, sort_order
)
SELECT s.id, seed.label, seed.lat, seed.lng, seed.kind, true, seed.sort_order
FROM (
  VALUES
    ('327fb699-542e-4ab6-b0b1-97022604bb88'::uuid, 'Tower H gate', 13.0715890919546, 77.7530337519604, 'gate', 10),
    ('327fb699-542e-4ab6-b0b1-97022604bb88'::uuid, 'Clubhouse driveway', 13.07205, 77.75255, 'clubhouse', 20),
    ('c42eb1d9-791c-4446-b7a9-6c37c132551a'::uuid, 'Campus main entrance', 37.4220009, -122.0840607, 'gate', 10)
) AS seed(society_id, label, lat, lng, kind, sort_order)
JOIN public.societies s ON s.id = seed.society_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.society_meetup_points m
  WHERE m.society_id = seed.society_id AND m.label = seed.label
);

-- Tighten request timeout cron to every 10 minutes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleaner-city-timeouts') THEN
    PERFORM cron.unschedule('cleaner-city-timeouts');
  END IF;
  PERFORM cron.schedule(
    'cleaner-city-timeouts',
    '*/10 * * * *',
    $cron$SELECT public.cleaner_city_process_timeouts();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cleaner-city-timeouts cron reschedule skipped: %', SQLERRM;
END;
$$;
