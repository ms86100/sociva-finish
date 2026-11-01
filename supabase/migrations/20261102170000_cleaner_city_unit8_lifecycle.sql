-- A Cleaner City Unit 8: server-owned ride lifecycle + pickup OTP.
-- Clients never mark started/completed locally.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS pickup_otp_hash text,
  ADD COLUMN IF NOT EXISTS pickup_otp_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_otp_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

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
  IF v_ride.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Only the host can generate pickup OTP';
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
    'confirmed', 'pickup_pending', '{}'::jsonb
  );

  -- Return plaintext once to host UI only (never stored)
  RETURN jsonb_build_object(
    'ride_id', v_ride.id,
    'otp', v_code,
    'expires_at', v_ride.pickup_otp_expires_at,
    'status', v_ride.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_generate_ride_otp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_generate_ride_otp(uuid) TO authenticated;

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
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status <> 'pickup_pending' THEN
    RAISE EXCEPTION 'Ride is not awaiting OTP start';
  END IF;
  IF v_ride.pickup_otp_expires_at IS NULL OR v_ride.pickup_otp_expires_at < now() THEN
    RAISE EXCEPTION 'OTP expired - generate a new one';
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

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_start_ride(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_start_ride(uuid, text) TO authenticated;

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
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid THEN
    RAISE EXCEPTION 'Only the host can complete the ride';
  END IF;
  IF v_ride.status <> 'started' THEN
    RAISE EXCEPTION 'Ride must be started before completion';
  END IF;

  v_from := v_ride.status;
  UPDATE public.rides
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  UPDATE public.commute_publications
  SET status = 'completed', updated_at = now()
  WHERE id = v_ride.publication_id
    AND status IN ('published', 'full');

  PERFORM public.cleaner_city_append_ride_event(
    v_ride.id, v_ride.society_id, v_uid, 'completed', v_from, 'completed', '{}'::jsonb
  );

  RETURN v_ride;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_complete_ride(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_complete_ride(uuid) TO authenticated;

COMMENT ON FUNCTION public.cleaner_city_generate_ride_otp IS
  'Unit 8: host generates one-time pickup code; plaintext returned once.';
COMMENT ON FUNCTION public.cleaner_city_start_ride IS
  'Unit 8: server validates OTP then marks started.';
COMMENT ON FUNCTION public.cleaner_city_complete_ride IS
  'Unit 8: host completes; clients never set completed locally.';
