-- Staging only (wwuanzbusxoyzixuprxs). SSV-006/007/009/011.
-- Do not apply on production kkzkuyhgdvyecmxtmkpy.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.visitor_entries
  ADD COLUMN IF NOT EXISTS otp_hash text;

UPDATE public.visitor_entries
SET otp_hash = crypt(otp_code, gen_salt('bf'))
WHERE otp_code IS NOT NULL
  AND length(otp_code) >= 4
  AND otp_hash IS NULL;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.visitor_entries FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.visitor_entries TO authenticated;
REVOKE SELECT (otp_code, otp_hash) ON public.visitor_entries FROM authenticated, anon, PUBLIC;

CREATE OR REPLACE FUNCTION public.visitor_create_entry(
  _visitor_name text,
  _visitor_phone text DEFAULT NULL,
  _visitor_type text DEFAULT 'guest',
  _purpose text DEFAULT NULL,
  _expected_date date DEFAULT NULL,
  _expected_time time DEFAULT NULL,
  _is_preapproved boolean DEFAULT true,
  _is_recurring boolean DEFAULT false,
  _recurring_days text[] DEFAULT NULL,
  _vehicle_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_otp text;
  v_hash text;
  v_row public.visitor_entries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM public.sociva_assert_rate_limit('visitor_create:' || v_uid::text, 8, 3600);

  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Active society membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_feature(v_society, 'visitor_management') THEN
    RAISE EXCEPTION 'Visitor management is not enabled' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_active_society_membership(v_uid, v_society) THEN
    RAISE EXCEPTION 'Suspended or pending members cannot create visitors' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(_visitor_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Visitor name required';
  END IF;

  IF COALESCE(_is_preapproved, true) THEN
    v_otp := public.sociva_generate_visitor_otp();
    v_hash := crypt(v_otp, gen_salt('bf'));
  END IF;

  INSERT INTO public.visitor_entries (
    society_id, resident_id, visitor_name, visitor_phone, visitor_type, purpose,
    expected_date, expected_time, otp_code, otp_hash, otp_expires_at, is_preapproved,
    is_recurring, recurring_days, vehicle_number, flat_number, status
  )
  VALUES (
    v_society,
    v_uid,
    left(btrim(_visitor_name), 120),
    NULLIF(btrim(COALESCE(_visitor_phone, '')), ''),
    COALESCE(NULLIF(btrim(_visitor_type), ''), 'guest'),
    NULLIF(btrim(COALESCE(_purpose, '')), ''),
    _expected_date,
    _expected_time,
    v_otp,
    v_hash,
    CASE WHEN v_otp IS NOT NULL THEN now() + interval '24 hours' ELSE NULL END,
    COALESCE(_is_preapproved, true),
    COALESCE(_is_recurring, false),
    CASE WHEN COALESCE(_is_recurring, false) THEN _recurring_days ELSE NULL END,
    NULLIF(btrim(COALESCE(_vehicle_number, '')), ''),
    (SELECT flat_number FROM public.profiles WHERE id = v_uid),
    'expected'
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'otp_code', v_otp,
    'society_id', v_row.society_id,
    'status', v_row.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.visitor_list_own_otps()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.sociva_assert_rate_limit('visitor_list_own_otps:' || v_uid::text, 20, 60);
  RETURN COALESCE((
    SELECT jsonb_object_agg(id::text, otp_code)
    FROM public.visitor_entries
    WHERE resident_id = v_uid
      AND status = 'expected'
      AND otp_code IS NOT NULL
      AND (otp_expires_at IS NULL OR otp_expires_at > now())
  ), '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_list_own_otps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_list_own_otps() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.visitor_guard_lookup_otp(_otp_code text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.visitor_entries%ROWTYPE;
  v_otp text := btrim(COALESCE(_otp_code, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF length(v_otp) < 4 THEN
    RAISE EXCEPTION 'Invalid OTP';
  END IF;
  PERFORM public.sociva_assert_rate_limit('visitor_redeem_otp:' || v_uid::text, 10, 60);

  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    SELECT ss.society_id INTO v_society
    FROM public.security_staff ss
    WHERE ss.user_id = v_uid AND ss.is_active = true
    LIMIT 1;
  END IF;
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Guard is not assigned to a society' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.security_staff ss
      WHERE ss.user_id = v_uid AND ss.society_id = v_society AND ss.is_active = true
    )
    OR public.is_society_admin(v_uid, v_society)
    OR public.is_admin(v_uid)
  ) THEN
    RAISE EXCEPTION 'Not a guard for this society' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_feature(v_society, 'visitor_management')
     AND NOT public.can_access_feature(v_society, 'gate_entry') THEN
    RAISE EXCEPTION 'Visitor management is not enabled' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.visitor_entries
  WHERE society_id = v_society
    AND status = 'expected'
    AND (otp_expires_at IS NULL OR otp_expires_at > now())
    AND (
      (otp_hash IS NOT NULL AND otp_hash = crypt(v_otp, otp_hash))
      OR (otp_hash IS NULL AND otp_code = v_otp)
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OTP not valid for this society';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'visitor_name', v_row.visitor_name,
    'visitor_phone', v_row.visitor_phone,
    'visitor_type', v_row.visitor_type,
    'vehicle_number', v_row.vehicle_number,
    'flat_number', v_row.flat_number,
    'expected_time', v_row.expected_time,
    'status', v_row.status,
    'society_id', v_row.society_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_guard_lookup_otp(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_guard_lookup_otp(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.visitor_guard_redeem_otp(_otp_code text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_row public.visitor_entries%ROWTYPE;
  v_otp text := btrim(COALESCE(_otp_code, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF length(v_otp) < 4 THEN
    RAISE EXCEPTION 'Invalid OTP';
  END IF;
  PERFORM public.sociva_assert_rate_limit('visitor_redeem_otp:' || v_uid::text, 10, 60);

  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    SELECT ss.society_id INTO v_society
    FROM public.security_staff ss
    WHERE ss.user_id = v_uid AND ss.is_active = true
    LIMIT 1;
  END IF;
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Guard is not assigned to a society' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.security_staff ss
      WHERE ss.user_id = v_uid AND ss.society_id = v_society AND ss.is_active = true
    )
    OR public.is_society_admin(v_uid, v_society)
    OR public.is_admin(v_uid)
  ) THEN
    RAISE EXCEPTION 'Not a guard for this society' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_feature(v_society, 'visitor_management')
     AND NOT public.can_access_feature(v_society, 'gate_entry') THEN
    RAISE EXCEPTION 'Visitor management is not enabled' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.visitor_entries
  WHERE society_id = v_society
    AND status = 'expected'
    AND (otp_expires_at IS NULL OR otp_expires_at > now())
    AND (
      (otp_hash IS NOT NULL AND otp_hash = crypt(v_otp, otp_hash))
      OR (otp_hash IS NULL AND otp_code = v_otp)
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'OTP not valid for this society';
  END IF;

  UPDATE public.visitor_entries
  SET status = 'checked_in',
      checked_in_at = now(),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.gate_entries (
    society_id, visitor_entry_id, guard_id, entry_type, visitor_name, visitor_phone,
    flat_number, purpose, status, user_id
  )
  VALUES (
    v_society, v_row.id, v_uid, 'visitor', v_row.visitor_name, v_row.visitor_phone,
    v_row.flat_number, v_row.purpose, 'entered', v_row.resident_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'society_id', v_row.society_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.visitor_set_status(_id uuid, _status text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.visitor_entries%ROWTYPE;
  v_new text := lower(btrim(COALESCE(_status, '')));
  v_is_guard boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_new NOT IN ('checked_in', 'checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid visitor status';
  END IF;

  PERFORM public.sociva_assert_rate_limit('visitor_set_status:' || v_uid::text, 30, 60);

  SELECT * INTO v_row FROM public.visitor_entries WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor entry not found';
  END IF;

  v_is_guard :=
    EXISTS (
      SELECT 1 FROM public.security_staff ss
      WHERE ss.user_id = v_uid AND ss.society_id = v_row.society_id AND ss.is_active = true
    )
    OR public.is_society_admin(v_uid, v_row.society_id)
    OR public.is_admin(v_uid);

  IF v_new = 'checked_in' AND NOT v_is_guard THEN
    RAISE EXCEPTION 'Check-in requires a guard OTP redeem' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_guard THEN
    IF v_row.resident_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_active_society_membership(v_uid, v_row.society_id) THEN
      RAISE EXCEPTION 'Active membership required' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT public.can_access_feature(v_row.society_id, 'visitor_management') THEN
    RAISE EXCEPTION 'Visitor management is not enabled' USING ERRCODE = '42501';
  END IF;

  UPDATE public.visitor_entries
  SET status = v_new,
      checked_in_at = CASE WHEN v_new = 'checked_in' THEN now() ELSE checked_in_at END,
      checked_out_at = CASE WHEN v_new = 'checked_out' THEN now() ELSE checked_out_at END,
      updated_at = now()
  WHERE id = _id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
END;
$$;

REVOKE ALL ON FUNCTION public.visitor_create_entry(text, text, text, text, date, time, boolean, boolean, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_create_entry(text, text, text, text, date, time, boolean, boolean, text[], text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.visitor_guard_redeem_otp(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_guard_redeem_otp(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.visitor_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_set_status(uuid, text) TO authenticated, service_role;
