-- Dogfood-friendly outbound call limits + clear abandoned ringing before busy check.
-- Also ignore short cancelled attempts so failed tests do not burn the hourly budget.

CREATE OR REPLACE FUNCTION public.voip_start_call(
  p_context_type text,
  p_context_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_auth record;
  v_existing public.call_sessions;
  v_row public.call_sessions;
  v_busy boolean;
  v_recent int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.voip_is_enabled() THEN
    RAISE EXCEPTION 'VoIP calling is not enabled yet';
  END IF;

  SELECT * INTO v_auth FROM public.voip_authorize_context(p_context_type, p_context_id, v_uid) LIMIT 1;
  IF NOT COALESCE(v_auth.ok, false) THEN
    RAISE EXCEPTION '%', COALESCE(v_auth.reason, 'not_authorized');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.call_sessions
    WHERE caller_id = v_uid
      AND context_type = p_context_type
      AND context_id = p_context_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object('call', row_to_json(v_existing), 'idempotent', true);
    END IF;
  END IF;

  -- End the caller's own stale ringing outbound so retries are not stuck.
  UPDATE public.call_sessions
  SET
    status = 'cancelled',
    ended_at = now(),
    end_reason = 'superseded_by_new_call',
    updated_at = now()
  WHERE caller_id = v_uid
    AND status = 'ringing'
    AND ringing_at < now() - interval '40 seconds';

  -- Soft spend cap: 30 meaningful outbound starts per context per hour.
  SELECT COUNT(*)::int INTO v_recent
  FROM public.call_sessions
  WHERE caller_id = v_uid
    AND context_type = p_context_type
    AND context_id = p_context_id
    AND created_at > now() - interval '1 hour'
    AND NOT (
      status IN ('cancelled', 'missed', 'failed')
      AND COALESCE(ended_at, updated_at) < created_at + interval '20 seconds'
    );
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'call_rate_limited';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.call_sessions
    WHERE callee_id = v_auth.callee_id
      AND status IN ('ringing', 'accepted', 'connecting', 'connected')
      AND caller_id <> v_uid
  ) INTO v_busy;
  IF v_busy THEN
    RAISE EXCEPTION 'busy';
  END IF;

  -- If callee only has our own ringing row, close it and place a fresh call.
  UPDATE public.call_sessions
  SET
    status = 'cancelled',
    ended_at = now(),
    end_reason = 'replaced_by_retry',
    updated_at = now()
  WHERE callee_id = v_auth.callee_id
    AND caller_id = v_uid
    AND status IN ('ringing', 'accepted', 'connecting');

  INSERT INTO public.call_sessions (
    caller_id, callee_id, context_type, context_id, society_id,
    status, livekit_room, ringing_at, idempotency_key
  ) VALUES (
    v_uid,
    v_auth.callee_id,
    p_context_type,
    p_context_id,
    v_auth.society_id,
    'ringing',
    'sociva-call-' || gen_random_uuid()::text,
    now(),
    nullif(trim(COALESCE(p_idempotency_key, '')), '')
  )
  RETURNING * INTO v_row;

  PERFORM public.voip_append_event(
    v_row.id, 'started', v_uid,
    jsonb_build_object('context_type', p_context_type, 'context_id', p_context_id)
  );

  RETURN jsonb_build_object('call', row_to_json(v_row), 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.voip_start_call(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_start_call(text, uuid, text) TO authenticated;
