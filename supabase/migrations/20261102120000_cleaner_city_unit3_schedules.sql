-- A Cleaner City Unit 3: flexible weekly templates + daily overrides.
-- Exit gate: changing one weekday or one date never rewrites other days.

ALTER TABLE public.commute_profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE public.commute_overrides
  ADD COLUMN IF NOT EXISTS override_kind text NOT NULL DEFAULT 'custom'
    CHECK (override_kind IN ('time_change', 'wfh', 'leave', 'holiday', 'custom'));

CREATE OR REPLACE FUNCTION public.cleaner_city_assert_schedule_access(p_uid uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_society uuid;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  v_society := public.get_user_society_id(p_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Society membership required';
  END IF;
  IF NOT public.can_access_feature(v_society, 'cleaner_city') AND NOT public.is_admin(p_uid) THEN
    RAISE EXCEPTION 'A Cleaner City is not enabled for this society';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commute_profiles cp
    WHERE cp.user_id = p_uid AND cp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Commute profile required before editing schedule';
  END IF;
  RETURN v_society;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_assert_schedule_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_assert_schedule_access(uuid) TO authenticated, service_role;

-- Upsert exactly one weekday. Never touches other weekdays.
CREATE OR REPLACE FUNCTION public.cleaner_city_set_commute_template(
  p_weekday smallint,
  p_is_working boolean DEFAULT true,
  p_depart_time time DEFAULT NULL,
  p_return_time time DEFAULT NULL,
  p_pickup_label text DEFAULT NULL,
  p_pickup_latitude double precision DEFAULT NULL,
  p_pickup_longitude double precision DEFAULT NULL
)
RETURNS public.commute_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.commute_templates;
BEGIN
  v_society := public.cleaner_city_assert_schedule_access(v_uid);

  IF p_weekday IS NULL OR p_weekday < 0 OR p_weekday > 6 THEN
    RAISE EXCEPTION 'weekday must be 0 (Sunday) through 6 (Saturday)';
  END IF;

  IF COALESCE(p_is_working, true) AND p_depart_time IS NULL THEN
    RAISE EXCEPTION 'depart_time required on working days';
  END IF;

  INSERT INTO public.commute_templates AS t (
    user_id, society_id, weekday, is_working, depart_time, return_time,
    pickup_label, pickup_latitude, pickup_longitude, updated_at
  )
  VALUES (
    v_uid, v_society, p_weekday, COALESCE(p_is_working, true),
    CASE WHEN COALESCE(p_is_working, true) THEN p_depart_time ELSE NULL END,
    CASE WHEN COALESCE(p_is_working, true) THEN p_return_time ELSE NULL END,
    NULLIF(trim(COALESCE(p_pickup_label, '')), ''),
    p_pickup_latitude, p_pickup_longitude, now()
  )
  ON CONFLICT (user_id, weekday) DO UPDATE SET
    society_id = EXCLUDED.society_id,
    is_working = EXCLUDED.is_working,
    depart_time = EXCLUDED.depart_time,
    return_time = EXCLUDED.return_time,
    pickup_label = EXCLUDED.pickup_label,
    pickup_latitude = EXCLUDED.pickup_latitude,
    pickup_longitude = EXCLUDED.pickup_longitude,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_commute_template(smallint, boolean, time, time, text, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_commute_template(smallint, boolean, time, time, text, double precision, double precision) TO authenticated;

-- Date-specific override. Never rewrites other dates or weekly templates.
CREATE OR REPLACE FUNCTION public.cleaner_city_set_commute_override(
  p_override_date date,
  p_is_working boolean DEFAULT true,
  p_depart_time time DEFAULT NULL,
  p_return_time time DEFAULT NULL,
  p_override_kind text DEFAULT 'custom',
  p_note text DEFAULT NULL,
  p_pickup_label text DEFAULT NULL,
  p_pickup_latitude double precision DEFAULT NULL,
  p_pickup_longitude double precision DEFAULT NULL
)
RETURNS public.commute_overrides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_kind text;
  v_working boolean;
  v_row public.commute_overrides;
BEGIN
  v_society := public.cleaner_city_assert_schedule_access(v_uid);

  IF p_override_date IS NULL THEN
    RAISE EXCEPTION 'override_date required';
  END IF;

  v_kind := COALESCE(NULLIF(trim(p_override_kind), ''), 'custom');
  IF v_kind NOT IN ('time_change', 'wfh', 'leave', 'holiday', 'custom') THEN
    RAISE EXCEPTION 'Invalid override_kind';
  END IF;

  -- WFH / leave / holiday imply not commuting that day unless explicitly overridden.
  IF v_kind IN ('wfh', 'leave', 'holiday') THEN
    v_working := COALESCE(p_is_working, false);
  ELSE
    v_working := COALESCE(p_is_working, true);
  END IF;

  IF v_working AND p_depart_time IS NULL THEN
    RAISE EXCEPTION 'depart_time required on working override days';
  END IF;

  INSERT INTO public.commute_overrides AS o (
    user_id, society_id, override_date, is_working, depart_time, return_time,
    override_kind, note, pickup_label, pickup_latitude, pickup_longitude, updated_at
  )
  VALUES (
    v_uid, v_society, p_override_date, v_working,
    CASE WHEN v_working THEN p_depart_time ELSE NULL END,
    CASE WHEN v_working THEN p_return_time ELSE NULL END,
    v_kind,
    NULLIF(trim(COALESCE(p_note, '')), ''),
    NULLIF(trim(COALESCE(p_pickup_label, '')), ''),
    p_pickup_latitude, p_pickup_longitude, now()
  )
  ON CONFLICT (user_id, override_date) DO UPDATE SET
    society_id = EXCLUDED.society_id,
    is_working = EXCLUDED.is_working,
    depart_time = EXCLUDED.depart_time,
    return_time = EXCLUDED.return_time,
    override_kind = EXCLUDED.override_kind,
    note = EXCLUDED.note,
    pickup_label = EXCLUDED.pickup_label,
    pickup_latitude = EXCLUDED.pickup_latitude,
    pickup_longitude = EXCLUDED.pickup_longitude,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_commute_override(date, boolean, time, time, text, text, text, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_commute_override(date, boolean, time, time, text, text, text, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_clear_commute_override(p_override_date date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer;
BEGIN
  PERFORM public.cleaner_city_assert_schedule_access(v_uid);
  IF p_override_date IS NULL THEN
    RAISE EXCEPTION 'override_date required';
  END IF;

  DELETE FROM public.commute_overrides
  WHERE user_id = v_uid AND override_date = p_override_date;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_clear_commute_override(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_clear_commute_override(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_pause_commute(p_paused boolean)
RETURNS public.commute_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.commute_profiles;
BEGIN
  PERFORM public.cleaner_city_assert_schedule_access(v_uid);

  UPDATE public.commute_profiles
  SET is_paused = COALESCE(p_paused, true), updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Commute profile required before editing schedule';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_pause_commute(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_pause_commute(boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleaner_city_set_timezone(p_timezone text)
RETURNS public.commute_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tz text;
  v_row public.commute_profiles;
BEGIN
  PERFORM public.cleaner_city_assert_schedule_access(v_uid);
  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'Asia/Kolkata');

  -- Validate IANA timezone via timestamptz AT TIME ZONE
  PERFORM now() AT TIME ZONE v_tz;

  UPDATE public.commute_profiles
  SET timezone = v_tz, updated_at = now()
  WHERE user_id = v_uid AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN invalid_parameter_value OR data_exception THEN
    RAISE EXCEPTION 'Invalid timezone';
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_set_timezone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_set_timezone(text) TO authenticated;

-- Resolve override over template for a calendar date. Does not mutate templates.
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
      'date', p_date,
      'source', 'none',
      'is_working', false,
      'is_paused', false,
      'timezone', 'Asia/Kolkata'
    );
  END IF;

  v_tz := COALESCE(v_profile.timezone, 'Asia/Kolkata');

  IF v_profile.is_paused THEN
    RETURN jsonb_build_object(
      'date', p_date,
      'source', 'paused',
      'is_working', false,
      'is_paused', true,
      'timezone', v_tz,
      'role', v_profile.role
    );
  END IF;

  SELECT * INTO v_override
  FROM public.commute_overrides
  WHERE user_id = p_user_id AND override_date = p_date;

  IF v_override.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'date', p_date,
      'source', 'override',
      'is_working', v_override.is_working,
      'is_paused', false,
      'timezone', v_tz,
      'depart_time', v_override.depart_time,
      'return_time', v_override.return_time,
      'pickup_label', v_override.pickup_label,
      'override_kind', v_override.override_kind,
      'note', v_override.note,
      'role', v_profile.role
    );
  END IF;

  v_dow := EXTRACT(DOW FROM p_date)::smallint;

  SELECT * INTO v_template
  FROM public.commute_templates
  WHERE user_id = p_user_id AND weekday = v_dow;

  IF v_template.id IS NULL THEN
    RETURN jsonb_build_object(
      'date', p_date,
      'source', 'none',
      'is_working', false,
      'is_paused', false,
      'timezone', v_tz,
      'weekday', v_dow,
      'role', v_profile.role
    );
  END IF;

  RETURN jsonb_build_object(
    'date', p_date,
    'source', 'template',
    'is_working', v_template.is_working,
    'is_paused', false,
    'timezone', v_tz,
    'weekday', v_dow,
    'depart_time', v_template.depart_time,
    'return_time', v_template.return_time,
    'pickup_label', v_template.pickup_label,
    'role', v_profile.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_effective_schedule(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_effective_schedule(uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.cleaner_city_set_commute_template(smallint, boolean, time, time, text, double precision, double precision) IS
  'Unit 3: upsert a single weekday template only; never mutates other weekdays.';
COMMENT ON FUNCTION public.cleaner_city_set_commute_override(date, boolean, time, time, text, text, text, double precision, double precision) IS
  'Unit 3: upsert one calendar-date override only; never mutates weekly templates or other dates.';
COMMENT ON FUNCTION public.cleaner_city_effective_schedule(uuid, date) IS
  'Unit 3: pause > override > template resolution for a date.';
