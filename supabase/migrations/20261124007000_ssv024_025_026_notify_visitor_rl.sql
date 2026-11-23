-- Staging only (wwuanzbusxoyzixuprxs). SSV-024/025/026:
-- Keep one-active unique index, rate-limit visitor create, pin help notify to JWT.
-- Do not apply on production kkzkuyhgdvyecmxtmkpy.

CREATE UNIQUE INDEX IF NOT EXISTS society_memberships_one_active_user
  ON public.society_memberships (user_id)
  WHERE (status = 'active');

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
  v_row public.visitor_entries%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM public.sociva_assert_rate_limit(
    'visitor_create:' || v_uid::text,
    8,
    3600
  );

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

CREATE OR REPLACE FUNCTION public.notify_help_request(_help_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_society uuid;
  v_req public.help_requests%ROWTYPE;
  v_queued int := 0;
  v_title text;
  v_body text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _help_request_id IS NULL THEN
    RAISE EXCEPTION 'help_request_id required';
  END IF;

  PERFORM public.sociva_assert_rate_limit(
    'notify_help_request:' || v_uid::text,
    8,
    3600
  );

  SELECT * INTO v_req FROM public.help_requests WHERE id = _help_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Help request not found' USING ERRCODE = '42501';
  END IF;

  v_society := public.get_user_society_id(v_uid);
  IF v_society IS NULL THEN
    RAISE EXCEPTION 'Active society membership required' USING ERRCODE = '42501';
  END IF;
  IF v_req.society_id IS DISTINCT FROM v_society THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_req.author_id IS DISTINCT FROM v_uid
     AND COALESCE(v_req.requester_id, v_uid) IS DISTINCT FROM v_uid
     AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  v_title := left(COALESCE(NULLIF(btrim(v_req.title), ''), 'Help request'), 80);
  v_body := left(COALESCE(v_req.title, 'A neighbor asked for help'), 180);

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, action_url, payload,
    society_id, status, idempotency_key, dedupe_key, event_created_at
  )
  SELECT
    sm.user_id,
    v_title,
    v_body,
    'help_request',
    '/community',
    '/community',
    jsonb_build_object('type', 'help_request', 'helpRequestId', v_req.id),
    v_society,
    'pending',
    'help_request:' || v_req.id::text || ':' || sm.user_id::text,
    'help_request:' || v_req.id::text || ':' || sm.user_id::text,
    now()
  FROM public.society_memberships sm
  WHERE sm.society_id = v_society
    AND sm.status = 'active'
    AND sm.user_id IS DISTINCT FROM v_uid
  LIMIT 200
  ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_queued = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'queued', v_queued, 'society_id', v_society);
END;
$$;

REVOKE ALL ON FUNCTION public.notify_help_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_help_request(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.visitor_create_entry(text, text, text, text, date, time, boolean, boolean, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visitor_create_entry(text, text, text, text, date, time, boolean, boolean, text[], text) TO authenticated, service_role;
