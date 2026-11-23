-- Staging only (wwuanzbusxoyzixuprxs). SSV-023:
-- Keep visitor redeem / set_status authz, add VOLATILE rate limits.
-- Do not apply on production kkzkuyhgdvyecmxtmkpy.

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

  PERFORM public.sociva_assert_rate_limit(
    'visitor_redeem_otp:' || v_uid::text,
    10,
    60
  );

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_new NOT IN ('checked_in', 'checked_out', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid visitor status';
  END IF;

  PERFORM public.sociva_assert_rate_limit(
    'visitor_set_status:' || v_uid::text,
    30,
    60
  );

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
