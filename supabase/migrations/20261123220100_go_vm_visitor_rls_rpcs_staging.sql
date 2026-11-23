-- GO-VM Phase 5 (staging): visitor writes via RPCs, society-scoped RLS,
-- restrictive feature gates, server-issued OTP.

CREATE OR REPLACE FUNCTION public.sociva_generate_visitor_otp()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path TO public, extensions
AS $$
  SELECT lpad(
    (
      (
        get_byte(gen_random_bytes(4), 0)::bigint
        + get_byte(gen_random_bytes(4), 1)::bigint * 256
        + get_byte(gen_random_bytes(4), 2)::bigint * 65536
        + get_byte(gen_random_bytes(4), 3)::bigint * 16777216
      ) % 900000 + 100000
    )::text,
    6,
    '0'
  )
$$;

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
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_otp text;
  v_row public.visitor_entries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

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
  END IF;

  INSERT INTO public.visitor_entries (
    society_id, resident_id, visitor_name, visitor_phone, visitor_type, purpose,
    expected_date, expected_time, otp_code, otp_expires_at, is_preapproved,
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
    'otp_code', v_row.otp_code,
    'society_id', v_row.society_id,
    'status', v_row.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.visitor_set_status(_id uuid, _status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.visitor_entries%ROWTYPE;
  v_new text := lower(btrim(COALESCE(_status, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_new NOT IN ('checked_in', 'checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid visitor status';
  END IF;

  SELECT * INTO v_row FROM public.visitor_entries WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor entry not found';
  END IF;
  IF v_row.resident_id IS DISTINCT FROM v_uid
     AND NOT public.is_admin(v_uid)
     AND NOT public.is_society_admin(v_uid, v_row.society_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_active_society_membership(v_uid, v_row.society_id)
     AND NOT public.is_admin(v_uid)
     AND NOT public.is_society_admin(v_uid, v_row.society_id) THEN
    RAISE EXCEPTION 'Active membership required' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.visitor_guard_redeem_otp(_otp_code text)
RETURNS jsonb
LANGUAGE plpgsql
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
    AND otp_code = v_otp
    AND status = 'expected'
    AND (otp_expires_at IS NULL OR otp_expires_at > now())
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

DROP POLICY IF EXISTS "Members can create visitor entries" ON public.visitor_entries;
DROP POLICY IF EXISTS "Residents can create visitor entries" ON public.visitor_entries;
DROP POLICY IF EXISTS "Residents can update own visitors" ON public.visitor_entries;
DROP POLICY IF EXISTS "feature_gate_visitor_entries_insert" ON public.visitor_entries;
DROP POLICY IF EXISTS "feature_gate_visitor_entries_update" ON public.visitor_entries;
DROP POLICY IF EXISTS "Society members can view visitor entries" ON public.visitor_entries;

CREATE POLICY visitor_entries_select_society
  ON public.visitor_entries
  FOR SELECT
  USING (
    public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
    OR society_id = public.get_user_society_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.security_staff ss
      WHERE ss.user_id = auth.uid()
        AND ss.society_id = visitor_entries.society_id
        AND ss.is_active = true
    )
  );

DROP POLICY IF EXISTS gate_entries_feature_gate_insert ON public.gate_entries;
DROP POLICY IF EXISTS "gate_entries_feature_gate_insert" ON public.gate_entries;

CREATE POLICY gate_entries_feature_gate_insert_restrictive
  ON public.gate_entries
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    public.can_access_feature(society_id, 'gate_entry')
    OR public.can_access_feature(society_id, 'visitor_management')
  );

REVOKE INSERT, UPDATE, DELETE ON public.visitor_entries FROM anon, authenticated;
GRANT SELECT ON public.visitor_entries TO authenticated;

REVOKE ALL ON FUNCTION public.visitor_create_entry(text, text, text, text, date, time, boolean, boolean, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_create_entry(text, text, text, text, date, time, boolean, boolean, text[], text) TO authenticated;

REVOKE ALL ON FUNCTION public.visitor_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_set_status(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.visitor_guard_redeem_otp(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_guard_redeem_otp(text) TO authenticated;
