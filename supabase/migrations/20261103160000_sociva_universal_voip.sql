-- Sociva universal in-app VoIP (LiveKit + CallKit/Telecom).
-- Feature-flagged off by default until LIVEKIT_* secrets and Apple VoIP cert are live.
-- No call recording. No phone numbers in call APIs.

CREATE TABLE IF NOT EXISTS public.voip_runtime_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  livekit_configured boolean NOT NULL DEFAULT false,
  apple_voip_push_configured boolean NOT NULL DEFAULT false,
  android_voip_push_configured boolean NOT NULL DEFAULT true,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.voip_runtime_config (id, enabled, notes)
VALUES (1, false, 'Disabled until LiveKit + Apple VoIP push are configured')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.voip_runtime_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voip_runtime_config_select ON public.voip_runtime_config;
CREATE POLICY voip_runtime_config_select ON public.voip_runtime_config
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS voip_runtime_config_admin_write ON public.voip_runtime_config;
CREATE POLICY voip_runtime_config_admin_write ON public.voip_runtime_config
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_type text NOT NULL
    CHECK (context_type IN (
      'cleaner_city_ride', 'order', 'helphub', 'booking', 'delivery', 'seller_order'
    )),
  context_id uuid NOT NULL,
  society_id uuid REFERENCES public.societies(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN (
      'initiated', 'ringing', 'accepted', 'connecting', 'connected',
      'rejected', 'missed', 'busy', 'failed', 'cancelled', 'ended'
    )),
  livekit_room text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ringing_at timestamptz,
  accepted_at timestamptz,
  connecting_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  duration_seconds int,
  idempotency_key text,
  caller_media_up boolean NOT NULL DEFAULT false,
  callee_media_up boolean NOT NULL DEFAULT false,
  dispatch_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_sessions_participants_distinct CHECK (caller_id <> callee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS call_sessions_idempotency_uidx
  ON public.call_sessions (caller_id, context_type, context_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_sessions_callee_active_idx
  ON public.call_sessions (callee_id, status)
  WHERE status IN ('ringing', 'accepted', 'connecting', 'connected');

CREATE INDEX IF NOT EXISTS call_sessions_context_idx
  ON public.call_sessions (context_type, context_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_events_event_len CHECK (char_length(event) BETWEEN 2 AND 64)
);

CREATE INDEX IF NOT EXISTS call_events_call_created_idx
  ON public.call_events (call_id, created_at ASC);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_sessions_select ON public.call_sessions;
CREATE POLICY call_sessions_select ON public.call_sessions
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR caller_id = auth.uid()
    OR callee_id = auth.uid()
  );

DROP POLICY IF EXISTS call_sessions_no_direct_write ON public.call_sessions;
CREATE POLICY call_sessions_no_direct_write ON public.call_sessions
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS call_events_select ON public.call_events;
CREATE POLICY call_events_select ON public.call_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.call_sessions s
      WHERE s.id = call_id
        AND (s.caller_id = auth.uid() OR s.callee_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS call_events_no_direct_write ON public.call_events;
CREATE POLICY call_events_no_direct_write ON public.call_events
  FOR INSERT TO authenticated
  WITH CHECK (false);

ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS voip_token text,
  ADD COLUMN IF NOT EXISTS voip_platform text
    CHECK (voip_platform IS NULL OR voip_platform IN ('ios_pushkit', 'android_fcm')),
  ADD COLUMN IF NOT EXISTS voip_token_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS device_tokens_voip_user_idx
  ON public.device_tokens (user_id)
  WHERE voip_token IS NOT NULL AND COALESCE(invalid, false) = false;

CREATE OR REPLACE FUNCTION public.voip_append_event(
  p_call_id uuid,
  p_event text,
  p_actor uuid DEFAULT auth.uid(),
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.call_events (call_id, event, actor_id, payload)
  VALUES (p_call_id, left(trim(p_event), 64), p_actor, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.voip_append_event(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_append_event(uuid, text, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.voip_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT enabled FROM public.voip_runtime_config WHERE id = 1), false);
$$;

REVOKE ALL ON FUNCTION public.voip_is_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_is_enabled() TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.voip_runtime_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg public.voip_runtime_config;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO v_cfg FROM public.voip_runtime_config WHERE id = 1;
  RETURN jsonb_build_object(
    'enabled', COALESCE(v_cfg.enabled, false),
    'livekit_configured', COALESCE(v_cfg.livekit_configured, false),
    'apple_voip_push_configured', COALESCE(v_cfg.apple_voip_push_configured, false),
    'android_voip_push_configured', COALESCE(v_cfg.android_voip_push_configured, true),
    'can_place_calls',
      COALESCE(v_cfg.enabled, false) AND COALESCE(v_cfg.livekit_configured, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.voip_runtime_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_runtime_capabilities() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_voip_token(
  p_voip_token text,
  p_voip_platform text,
  p_alert_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF nullif(trim(p_voip_token), '') IS NULL THEN
    RAISE EXCEPTION 'voip token required';
  END IF;
  IF p_voip_platform NOT IN ('ios_pushkit', 'android_fcm') THEN
    RAISE EXCEPTION 'invalid voip platform';
  END IF;

  IF p_alert_token IS NOT NULL THEN
    UPDATE public.device_tokens
    SET voip_token = trim(p_voip_token),
        voip_platform = p_voip_platform,
        voip_token_updated_at = now(),
        updated_at = now()
    WHERE user_id = v_uid
      AND token = p_alert_token
      AND COALESCE(invalid, false) = false;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  IF v_n = 0 THEN
    UPDATE public.device_tokens
    SET voip_token = trim(p_voip_token),
        voip_platform = p_voip_platform,
        voip_token_updated_at = now(),
        updated_at = now()
    WHERE id = (
      SELECT id FROM public.device_tokens
      WHERE user_id = v_uid AND COALESCE(invalid, false) = false
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    );
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_voip_token(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_voip_token(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.voip_authorize_context(
  p_context_type text,
  p_context_id uuid,
  p_uid uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  ok boolean,
  callee_id uuid,
  society_id uuid,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ride public.rides;
  v_order record;
BEGIN
  IF p_uid IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'not_authenticated'::text;
    RETURN;
  END IF;

  IF p_context_type = 'cleaner_city_ride' THEN
    SELECT * INTO v_ride FROM public.rides WHERE id = p_context_id;
    IF v_ride.id IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'ride_not_found'::text;
      RETURN;
    END IF;
    IF v_ride.host_user_id <> p_uid AND v_ride.guest_user_id <> p_uid THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'not_participant'::text;
      RETURN;
    END IF;
    IF v_ride.status NOT IN ('confirmed', 'pickup_pending', 'started') THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'ride_not_callable'::text;
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.commute_blocks b
      WHERE (b.blocker_user_id = v_ride.host_user_id AND b.blocked_user_id = v_ride.guest_user_id)
         OR (b.blocker_user_id = v_ride.guest_user_id AND b.blocked_user_id = v_ride.host_user_id)
    ) THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'blocked'::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      true,
      CASE WHEN v_ride.host_user_id = p_uid THEN v_ride.guest_user_id ELSE v_ride.host_user_id END,
      v_ride.society_id,
      NULL::text;
    RETURN;
  END IF;

  IF p_context_type IN ('order', 'seller_order') THEN
    SELECT o.id,
           o.buyer_id,
           sp.user_id AS seller_user_id,
           COALESCE(o.society_id, o.buyer_society_id, o.seller_society_id) AS society_id,
           o.status
      INTO v_order
    FROM public.orders o
    LEFT JOIN public.seller_profiles sp ON sp.id = o.seller_id
    WHERE o.id = p_context_id;
    IF v_order.id IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'order_not_found'::text;
      RETURN;
    END IF;
    IF v_order.buyer_id <> p_uid AND v_order.seller_user_id <> p_uid THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'not_participant'::text;
      RETURN;
    END IF;
    IF v_order.status::text IN ('cancelled', 'completed', 'delivered', 'refunded') THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'order_not_callable'::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT
      true,
      CASE WHEN v_order.buyer_id = p_uid THEN v_order.seller_user_id ELSE v_order.buyer_id END,
      v_order.society_id,
      NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, 'context_unsupported'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.voip_authorize_context(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_authorize_context(text, uuid, uuid) TO authenticated, service_role;

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

  SELECT EXISTS (
    SELECT 1 FROM public.call_sessions
    WHERE callee_id = v_auth.callee_id
      AND status IN ('ringing', 'accepted', 'connecting', 'connected')
  ) INTO v_busy;
  IF v_busy THEN
    RAISE EXCEPTION 'busy';
  END IF;

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

CREATE OR REPLACE FUNCTION public.voip_respond_call(
  p_call_id uuid,
  p_accept boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.call_sessions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO v_row FROM public.call_sessions WHERE id = p_call_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Call not found';
  END IF;
  IF v_row.callee_id <> v_uid THEN
    RAISE EXCEPTION 'Only callee can respond';
  END IF;
  IF v_row.status NOT IN ('ringing', 'initiated') THEN
    RAISE EXCEPTION 'Call is not ringing';
  END IF;

  IF p_accept THEN
    UPDATE public.call_sessions
    SET status = 'accepted',
        accepted_at = now(),
        connecting_at = now(),
        updated_at = now()
    WHERE id = p_call_id
    RETURNING * INTO v_row;
    PERFORM public.voip_append_event(p_call_id, 'accepted', v_uid, '{}'::jsonb);
  ELSE
    UPDATE public.call_sessions
    SET status = 'rejected',
        ended_at = now(),
        end_reason = 'rejected',
        updated_at = now()
    WHERE id = p_call_id
    RETURNING * INTO v_row;
    PERFORM public.voip_append_event(p_call_id, 'rejected', v_uid, '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object('call', row_to_json(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.voip_respond_call(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_respond_call(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.voip_heartbeat(
  p_call_id uuid,
  p_media_up boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.call_sessions;
BEGIN
  SELECT * INTO v_row FROM public.call_sessions WHERE id = p_call_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Call not found';
  END IF;
  IF v_row.caller_id <> v_uid AND v_row.callee_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  IF v_uid = v_row.caller_id THEN
    UPDATE public.call_sessions
    SET caller_media_up = COALESCE(p_media_up, caller_media_up),
        updated_at = now()
    WHERE id = p_call_id
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.call_sessions
    SET callee_media_up = COALESCE(p_media_up, callee_media_up),
        updated_at = now()
    WHERE id = p_call_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.caller_media_up AND v_row.callee_media_up AND v_row.status IN ('accepted', 'connecting') THEN
    UPDATE public.call_sessions
    SET status = 'connected',
        connected_at = COALESCE(connected_at, now()),
        updated_at = now()
    WHERE id = p_call_id
    RETURNING * INTO v_row;
    PERFORM public.voip_append_event(p_call_id, 'connected', v_uid, '{}'::jsonb);
  ELSIF v_row.status = 'accepted' THEN
    UPDATE public.call_sessions
    SET status = 'connecting',
        connecting_at = COALESCE(connecting_at, now()),
        updated_at = now()
    WHERE id = p_call_id
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('call', row_to_json(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.voip_heartbeat(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_heartbeat(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.voip_end_call(
  p_call_id uuid,
  p_reason text DEFAULT 'ended'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.call_sessions;
  v_dur int;
BEGIN
  SELECT * INTO v_row FROM public.call_sessions WHERE id = p_call_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Call not found';
  END IF;
  IF v_row.caller_id <> v_uid AND v_row.callee_id <> v_uid AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('call', row_to_json(v_row), 'already_ended', true);
  END IF;

  v_dur := CASE
    WHEN v_row.connected_at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - v_row.connected_at))::int)
    ELSE 0
  END;

  UPDATE public.call_sessions
  SET status = CASE
        WHEN status = 'ringing' AND caller_id = v_uid THEN 'cancelled'
        WHEN status = 'ringing' AND callee_id = v_uid THEN 'rejected'
        WHEN status IN ('accepted', 'connecting') AND ended_at IS NULL AND p_reason = 'missed' THEN 'missed'
        ELSE 'ended'
      END,
      ended_at = now(),
      end_reason = left(COALESCE(nullif(trim(p_reason), ''), 'ended'), 64),
      duration_seconds = v_dur,
      updated_at = now()
  WHERE id = p_call_id
  RETURNING * INTO v_row;

  PERFORM public.voip_append_event(
    p_call_id, 'ended', v_uid,
    jsonb_build_object('reason', v_row.end_reason, 'duration_seconds', v_dur)
  );

  RETURN jsonb_build_object('call', row_to_json(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.voip_end_call(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_end_call(uuid, text) TO authenticated, service_role;

-- Ring timeout sweeper (miss after 30s). Safe to call from cron or edge.
CREATE OR REPLACE FUNCTION public.voip_sweep_missed_rings(p_timeout_seconds int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.call_sessions
    WHERE status = 'ringing'
      AND ringing_at < now() - make_interval(secs => GREATEST(10, p_timeout_seconds))
  LOOP
    UPDATE public.call_sessions
    SET status = 'missed',
        ended_at = now(),
        end_reason = 'ring_timeout',
        updated_at = now()
    WHERE id = r.id;
    PERFORM public.voip_append_event(r.id, 'missed', NULL, jsonb_build_object('reason', 'ring_timeout'));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.voip_sweep_missed_rings(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voip_sweep_missed_rings(int) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_voip_enabled(
  p_enabled boolean,
  p_livekit_configured boolean DEFAULT NULL,
  p_apple_voip_push_configured boolean DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.voip_runtime_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.voip_runtime_config;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  UPDATE public.voip_runtime_config
  SET enabled = p_enabled,
      livekit_configured = COALESCE(p_livekit_configured, livekit_configured),
      apple_voip_push_configured = COALESCE(p_apple_voip_push_configured, apple_voip_push_configured),
      notes = COALESCE(p_notes, notes),
      updated_at = now(),
      updated_by = v_uid
  WHERE id = 1
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_voip_enabled(boolean, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_voip_enabled(boolean, boolean, boolean, text) TO authenticated;

COMMENT ON TABLE public.call_sessions IS
  'Peer in-app VoIP sessions (LiveKit). Enabled via voip_runtime_config.';
COMMENT ON FUNCTION public.voip_start_call IS
  'Start a gated VoIP call for an authorized context. Requires voip_runtime_config.enabled.';
