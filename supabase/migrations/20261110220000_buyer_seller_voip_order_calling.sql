-- Buyer-seller in-app calling: explicit order status allowlist + LiveKit spend caps.
-- No Twilio. Caps: 3 outbound calls / context / hour, 10 minute max connected duration.

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
    -- Explicit allowlist (commerce + booking + contact enquiry).
    IF v_order.status::text NOT IN (
      'placed', 'accepted', 'preparing', 'ready', 'picked_up',
      'on_the_way', 'at_gate', 'arrived', 'assigned', 'en_route',
      'in_progress', 'payment_pending', 'awaiting_cod_confirmation',
      'enquired', 'quoted', 'requested',
      'scheduled', 'confirmed', 'rescheduled'
    ) THEN
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

  -- Soft spend cap: 3 outbound starts per context per hour (caller).
  SELECT COUNT(*)::int INTO v_recent
  FROM public.call_sessions
  WHERE caller_id = v_uid
    AND context_type = p_context_type
    AND context_id = p_context_id
    AND created_at > now() - interval '1 hour';
  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'call_rate_limited';
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
  v_dur int;
BEGIN
  SELECT * INTO v_row FROM public.call_sessions WHERE id = p_call_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Call not found';
  END IF;
  IF v_row.caller_id <> v_uid AND v_row.callee_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  -- Hard cap: auto-end after 10 minutes connected (LiveKit spend control).
  IF v_row.connected_at IS NOT NULL
     AND v_row.ended_at IS NULL
     AND v_row.status IN ('connected', 'connecting', 'accepted')
     AND v_row.connected_at < now() - interval '10 minutes'
  THEN
    v_dur := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_row.connected_at))::int);
    UPDATE public.call_sessions
    SET status = 'ended',
        ended_at = now(),
        end_reason = 'max_duration',
        duration_seconds = v_dur,
        updated_at = now()
    WHERE id = p_call_id
    RETURNING * INTO v_row;
    PERFORM public.voip_append_event(
      p_call_id, 'ended', v_uid,
      jsonb_build_object('reason', 'max_duration', 'duration_seconds', v_dur)
    );
    RETURN jsonb_build_object('call', row_to_json(v_row), 'auto_ended', true);
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

COMMENT ON FUNCTION public.voip_authorize_context IS
  'Authorize VoIP for cleaner_city_ride and order/seller_order with explicit active status allowlist.';
COMMENT ON FUNCTION public.voip_start_call IS
  'Start a LiveKit call session; rate-limited to 3 starts per caller/context/hour.';
COMMENT ON FUNCTION public.voip_heartbeat IS
  'Heartbeat media flags; auto-ends connected calls after 10 minutes.';
