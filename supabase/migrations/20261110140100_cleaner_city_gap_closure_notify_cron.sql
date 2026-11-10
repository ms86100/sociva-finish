-- OTP/start notifies, T-30 departure reminders, drop unlocked request_ride overload,
-- autopilot uniqueness, finer reminder cron.

-- Drop legacy 2-arg overload (no guest booking lock)
DROP FUNCTION IF EXISTS public.cleaner_city_request_ride(uuid, text);

-- Ensure 6-arg request_ride still calls guest lock (re-assert via wrapper comment)
COMMENT ON FUNCTION public.cleaner_city_request_ride(
  uuid, text, double precision, double precision, double precision, double precision
) IS 'Seat request with publication FOR UPDATE + cleaner_city_lock_guest_booking advisory lock';

-- Unique open publication per host/date/direction (autopilot dedupe)
CREATE UNIQUE INDEX IF NOT EXISTS commute_publications_host_date_dir_open_uidx
  ON public.commute_publications (host_user_id, travel_date, direction)
  WHERE status IN ('draft', 'published', 'full');

-- Patch OTP generate: notify host
CREATE OR REPLACE FUNCTION public.cleaner_city_generate_ride_otp(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_code text;
  v_hash text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.guest_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the passenger can generate the pickup OTP';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending') THEN
    RAISE EXCEPTION 'OTP only available after confirmation';
  END IF;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  v_hash := encode(
    extensions.digest(convert_to(v_code || ':' || p_ride_id::text, 'UTF8'), 'sha256'),
    'hex'
  );

  UPDATE public.rides
  SET
    pickup_otp_hash = v_hash,
    pickup_otp_expires_at = now() + interval '30 minutes',
    pickup_otp_attempt_count = 0,
    status = 'pickup_pending',
    updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'otp_generated',
    'confirmed', 'pickup_pending', jsonb_build_object('holder', 'passenger')
  );

  PERFORM public.cleaner_city_enqueue_notify(
    v_ride.host_user_id,
    'Pickup code ready',
    'Your passenger generated the pickup OTP. Open the ride to start when you meet.',
    'cleaner_city_ride_update',
    v_ride.id,
    v_ride.society_id,
    'cc_otp_ready_h_' || v_ride.id::text || '_' || to_char(now(), 'YYYYMMDDHH24MI')
  );

  RETURN jsonb_build_object(
    'ride_id', v_ride.id,
    'otp', v_code,
    'expires_at', v_ride.pickup_otp_expires_at,
    'status', v_ride.status,
    'holder', 'passenger'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_start_ride(
  p_ride_id uuid,
  p_otp text
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_hash text;
  v_from text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the rider can start the trip with the passenger OTP';
  END IF;
  IF v_ride.status <> 'pickup_pending' THEN
    RAISE EXCEPTION 'Ride is not awaiting OTP start';
  END IF;
  IF v_ride.pickup_otp_expires_at IS NULL OR v_ride.pickup_otp_expires_at < now() THEN
    RAISE EXCEPTION 'OTP expired - passenger must generate a new one';
  END IF;
  IF COALESCE(v_ride.pickup_otp_attempt_count, 0) >= 5 THEN
    UPDATE public.rides
    SET status = 'verification_failed', updated_at = now()
    WHERE id = p_ride_id;
    RAISE EXCEPTION 'Too many OTP attempts';
  END IF;

  v_hash := encode(
    extensions.digest(convert_to(trim(p_otp) || ':' || p_ride_id::text, 'UTF8'), 'sha256'),
    'hex'
  );
  IF v_hash IS DISTINCT FROM v_ride.pickup_otp_hash THEN
    UPDATE public.rides
    SET pickup_otp_attempt_count = pickup_otp_attempt_count + 1, updated_at = now()
    WHERE id = p_ride_id;
    RAISE EXCEPTION 'Invalid OTP';
  END IF;

  v_from := v_ride.status;
  UPDATE public.rides
  SET
    status = 'started',
    started_at = now(),
    pickup_otp_hash = NULL,
    pickup_otp_expires_at = NULL,
    updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'started', v_from, 'started', '{}'::jsonb
  );

  PERFORM public.cleaner_city_enqueue_notify(
    v_ride.guest_user_id,
    'Ride started',
    'Your host started the commute. Live location and chat are available on the ride.',
    'cleaner_city_ride_update',
    v_ride.id,
    v_ride.society_id,
    'cc_started_g_' || v_ride.id::text
  );

  RETURN v_ride;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_send_commute_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tomorrow date := (timezone('Asia/Kolkata', now()))::date + 1;
  v_today date := (timezone('Asia/Kolkata', now()))::date;
  v_hour integer := EXTRACT(HOUR FROM timezone('Asia/Kolkata', now()))::integer;
  v_now_ist timestamp without time zone := timezone('Asia/Kolkata', now());
  v_evening integer := 0;
  v_morning integer := 0;
  v_depart integer := 0;
  r record;
  g record;
  v_sched jsonb;
  v_depart_ts timestamp without time zone;
  v_mins integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  IF v_hour BETWEEN 19 AND 21 THEN
    FOR r IN
      SELECT cp.* FROM public.commute_profiles cp
      WHERE cp.deleted_at IS NULL AND cp.is_paused = false
        AND cp.role IN ('host', 'both')
    LOOP
      v_sched := public.cleaner_city_effective_schedule(r.user_id, v_tomorrow);
      IF COALESCE((v_sched->>'is_working')::boolean, false)
         AND NOT EXISTS (
           SELECT 1 FROM public.commute_publications p
           WHERE p.host_user_id = r.user_id AND p.travel_date = v_tomorrow
             AND p.status IN ('draft', 'published', 'full')
         ) THEN
        PERFORM public.cleaner_city_enqueue_notify(
          r.user_id,
          'Publish tomorrow commute?',
          'Your schedule says you are commuting tomorrow. Offer seats or enable Autopilot.',
          'cleaner_city_ride_update',
          NULL,
          r.society_id,
          'cc_remind_pub_' || r.user_id::text || '_' || v_tomorrow::text
        );
        v_evening := v_evening + 1;
      END IF;
    END LOOP;
  END IF;

  IF v_hour BETWEEN 6 AND 8 THEN
    FOR r IN
      SELECT * FROM public.rides
      WHERE travel_date = v_today
        AND status IN ('confirmed', 'pickup_pending')
    LOOP
      PERFORM public.cleaner_city_enqueue_notify(
        r.host_user_id,
        'Commute today',
        'You have a Cleaner City ride today. Open for OTP and pickup.',
        'cleaner_city_ride_update',
        r.id,
        r.society_id,
        'cc_remind_am_h_' || r.id::text
      );
      PERFORM public.cleaner_city_enqueue_notify(
        r.guest_user_id,
        'Commute today',
        'Your seat is confirmed for today. Open for meeting point and OTP.',
        'cleaner_city_ride_update',
        r.id,
        r.society_id,
        'cc_remind_am_g_' || r.id::text
      );
      v_morning := v_morning + 1;
    END LOOP;
  END IF;

  -- T-30 departure reminders for today's published offers + confirmed rides
  FOR r IN
    SELECT p.id AS publication_id, p.host_user_id, p.society_id, p.travel_date, p.depart_time,
           p.direction, p.origin_label, p.destination_label
    FROM public.commute_publications p
    WHERE p.travel_date = v_today
      AND p.status IN ('published', 'full')
  LOOP
    v_depart_ts := (r.travel_date::timestamp + r.depart_time);
    v_mins := floor(extract(epoch FROM (v_depart_ts - v_now_ist)) / 60)::integer;
    IF v_mins BETWEEN 25 AND 35 THEN
      PERFORM public.cleaner_city_enqueue_notify(
        r.host_user_id,
        'Leaving in about 30 minutes',
        coalesce(r.origin_label, 'Pickup') || ' to ' || coalesce(r.destination_label, 'drop') ||
          '. Open Offer / Missions to meet passengers.',
        'cleaner_city_ride_update',
        NULL,
        r.society_id,
        'cc_depart30_h_' || r.publication_id::text || '_' || v_today::text
      );
      v_depart := v_depart + 1;
      FOR g IN
        SELECT id, guest_user_id, society_id FROM public.rides
        WHERE publication_id = r.publication_id
          AND status IN ('confirmed', 'pickup_pending', 'started')
      LOOP
        PERFORM public.cleaner_city_enqueue_notify(
          g.guest_user_id,
          'Pickup in about 30 minutes',
          'Your Cleaner City seat leaves soon. Open the ride for meeting point and OTP.',
          'cleaner_city_ride_update',
          g.id,
          g.society_id,
          'cc_depart30_g_' || g.id::text
        );
        v_depart := v_depart + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'evening_prompts', v_evening,
    'morning_ride_nudges', v_morning,
    'depart_t30', v_depart
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_send_commute_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_send_commute_reminders() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('cleaner-city-reminders');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'cleaner-city-reminders',
      '*/5 * * * *',
      $cron$SELECT public.cleaner_city_send_commute_reminders();$cron$
    );
  END IF;
END $$;
