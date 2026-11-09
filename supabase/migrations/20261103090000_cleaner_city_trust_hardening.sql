-- Cleaner City trust hardening:
-- ride evidence timeline, share revoke, pilot metrics, config flags.
-- No conversation content stored.

CREATE TABLE IF NOT EXISTS public.ride_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ride_lifecycle_events_event_len CHECK (char_length(event) BETWEEN 2 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_ride_lifecycle_events_ride_created
  ON public.ride_lifecycle_events (ride_id, created_at ASC);

ALTER TABLE public.ride_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ride_lifecycle_events_select ON public.ride_lifecycle_events;
CREATE POLICY ride_lifecycle_events_select ON public.ride_lifecycle_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.cleaner_city_is_ride_participant(ride_id, auth.uid())
  );

-- Participants never insert directly; SECURITY DEFINER helpers append.
DROP POLICY IF EXISTS ride_lifecycle_events_insert ON public.ride_lifecycle_events;
CREATE POLICY ride_lifecycle_events_insert ON public.ride_lifecycle_events
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.cleaner_city_append_ride_event(
  p_ride_id uuid,
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
  v_ride public.rides;
  v_id uuid;
BEGIN
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  INSERT INTO public.ride_lifecycle_events (
    ride_id, society_id, event, actor_user_id, payload
  ) VALUES (
    p_ride_id,
    v_ride.society_id,
    left(trim(p_event), 64),
    p_actor,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_append_ride_event(uuid, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_append_ride_event(uuid, text, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleaner_city_list_ride_events(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.is_admin(v_uid)
    OR public.cleaner_city_is_ride_participant(p_ride_id, v_uid)
  ) THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'event', e.event,
        'actor_user_id', e.actor_user_id,
        'payload', e.payload,
        'created_at', e.created_at
      )
      ORDER BY e.created_at ASC
    )
    FROM public.ride_lifecycle_events e
    WHERE e.ride_id = p_ride_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_list_ride_events(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_list_ride_events(uuid) TO authenticated;

-- Shorter share window + explicit revoke.
CREATE OR REPLACE FUNCTION public.cleaner_city_create_share_token(p_ride_id uuid)
RETURNS public.ride_share_tokens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ride public.rides;
  v_row public.ride_share_tokens;
  v_token text;
BEGIN
  PERFORM public.cleaner_city_require_verified_commuter(v_uid);
  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id;
  IF v_ride.id IS NULL THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.host_user_id <> v_uid AND v_ride.guest_user_id <> v_uid THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  IF v_ride.status NOT IN ('confirmed', 'pickup_pending', 'started') THEN
    RAISE EXCEPTION 'Share only available for active/confirmed rides';
  END IF;

  UPDATE public.ride_share_tokens
  SET revoked_at = now()
  WHERE ride_id = p_ride_id AND created_by = v_uid AND revoked_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(18), 'hex');

  INSERT INTO public.ride_share_tokens (
    ride_id, society_id, created_by, token, expires_at
  )
  VALUES (
    p_ride_id, v_ride.society_id, v_uid, v_token, now() + interval '2 hours'
  )
  RETURNING * INTO v_row;

  PERFORM public.cleaner_city_append_ride_event(
    p_ride_id,
    'share_token_created',
    v_uid,
    jsonb_build_object('expires_at', v_row.expires_at)
  );

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleaner_city_revoke_share_token(p_ride_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n int := 0;
BEGIN
  IF NOT public.cleaner_city_is_ride_participant(p_ride_id, v_uid) THEN
    RAISE EXCEPTION 'Not a participant';
  END IF;
  UPDATE public.ride_share_tokens
  SET revoked_at = now()
  WHERE ride_id = p_ride_id
    AND created_by = v_uid
    AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.cleaner_city_append_ride_event(
      p_ride_id,
      'share_token_revoked',
      v_uid,
      jsonb_build_object('revoked_count', v_n)
    );
  END IF;
  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_revoke_share_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_revoke_share_token(uuid) TO authenticated;

-- Status changes append evidence (no PII).
CREATE OR REPLACE FUNCTION public.cleaner_city_ride_status_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.cleaner_city_append_ride_event(
      NEW.id,
      'ride_created',
      COALESCE(NEW.guest_user_id, NEW.host_user_id),
      jsonb_build_object('status', NEW.status)
    );
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.cleaner_city_append_ride_event(
      NEW.id,
      'status_' || NEW.status,
      auth.uid(),
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;
  IF NEW.meeting_point_label IS DISTINCT FROM OLD.meeting_point_label
     OR NEW.meeting_point_latitude IS DISTINCT FROM OLD.meeting_point_latitude THEN
    PERFORM public.cleaner_city_append_ride_event(
      NEW.id,
      'meeting_pin_set',
      auth.uid(),
      jsonb_build_object(
        'has_coords',
        (NEW.meeting_point_latitude IS NOT NULL AND NEW.meeting_point_longitude IS NOT NULL)
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cleaner_city_ride_status_evidence ON public.rides;
CREATE TRIGGER cleaner_city_ride_status_evidence
  AFTER INSERT OR UPDATE OF status, meeting_point_label, meeting_point_latitude, meeting_point_longitude
  ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.cleaner_city_ride_status_evidence();

-- Pilot KPIs (society scoped). No message bodies.
CREATE OR REPLACE FUNCTION public.cleaner_city_admin_stats(p_society_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (timezone('Asia/Kolkata', now()))::date;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN jsonb_build_object(
    'profiles', (SELECT count(*) FROM public.commute_profiles WHERE deleted_at IS NULL
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'verified', (SELECT count(*) FROM public.work_verifications wv
      JOIN public.commute_profiles cp ON cp.user_id = wv.user_id AND cp.deleted_at IS NULL
      WHERE wv.status = 'verified'
        AND (p_society_id IS NULL OR cp.society_id = p_society_id)),
    'active_vehicles', (SELECT count(*) FROM public.vehicles WHERE is_active = true
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'publications_open', (SELECT count(*) FROM public.commute_publications
      WHERE status IN ('published', 'full') AND travel_date >= v_today
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'rides_today', (SELECT count(*) FROM public.rides WHERE travel_date = v_today
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'rides_active', (SELECT count(*) FROM public.rides
      WHERE status IN ('requested', 'confirmed', 'pickup_pending', 'started')
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'rides_completed_7d', (SELECT count(*) FROM public.rides
      WHERE status = 'completed' AND travel_date >= (v_today - 7)
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'rides_cancelled_7d', (SELECT count(*) FROM public.rides
      WHERE status = 'cancelled' AND travel_date >= (v_today - 7)
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'rides_no_show_7d', (SELECT count(*) FROM public.rides
      WHERE status = 'no_show' AND travel_date >= (v_today - 7)
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'incidents_open', (SELECT count(*) FROM public.ride_incidents WHERE status = 'open'
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'cost_shares_proposed', (SELECT count(*) FROM public.ride_cost_shares WHERE status = 'proposed'
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'domains_pending', (SELECT count(*) FROM public.company_domains WHERE status = 'pending'),
    'avg_rating', (SELECT round(avg(stars)::numeric, 2) FROM public.ride_ratings rr
      JOIN public.rides r ON r.id = rr.ride_id
      WHERE (p_society_id IS NULL OR r.society_id = p_society_id)),
    'share_links_active', (SELECT count(*) FROM public.ride_share_tokens
      WHERE revoked_at IS NULL AND expires_at > now()
      AND (p_society_id IS NULL OR society_id = p_society_id)),
    'meeting_pin_set_today', (SELECT count(*) FROM public.rides
      WHERE travel_date = v_today
        AND meeting_point_label IS NOT NULL
        AND (p_society_id IS NULL OR society_id = p_society_id)),
    'completion_rate_7d', (
      SELECT CASE
        WHEN count(*) FILTER (WHERE status IN ('completed', 'cancelled', 'no_show', 'disputed')) = 0 THEN NULL
        ELSE round(
          (100.0 * count(*) FILTER (WHERE status = 'completed')
            / nullif(count(*) FILTER (WHERE status IN ('completed', 'cancelled', 'no_show', 'disputed')), 0)
          )::numeric,
          1
        )
      END
      FROM public.rides
      WHERE travel_date >= (v_today - 7)
        AND (p_society_id IS NULL OR society_id = p_society_id)
    )
  );
END;
$$;

-- Runtime config honesty for client (no secrets returned).
CREATE OR REPLACE FUNCTION public.cleaner_city_runtime_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_twilio boolean := false;
  v_sms boolean := false;
  v_fuel boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT
    COALESCE(bool_or(key = 'twilio_account_sid' AND nullif(trim(value), '') IS NOT NULL), false)
      AND COALESCE(bool_or(key = 'twilio_auth_token' AND nullif(trim(value), '') IS NOT NULL), false)
      AND COALESCE(bool_or(key = 'twilio_phone_number' AND nullif(trim(value), '') IS NOT NULL), false)
  INTO v_twilio
  FROM public.admin_settings
  WHERE key IN ('twilio_account_sid', 'twilio_auth_token', 'twilio_phone_number');

  SELECT
    COALESCE(bool_or(key = 'msg91_auth_key' AND nullif(trim(value), '') IS NOT NULL), false)
      AND COALESCE(bool_or(key = 'msg91_sos_template_id' AND nullif(trim(value), '') IS NOT NULL), false)
  INTO v_sms
  FROM public.admin_settings
  WHERE key IN ('msg91_auth_key', 'msg91_sos_template_id');

  -- Fuel guest checkout needs Razorpay keys; host payout needs route account separately.
  SELECT
    COALESCE(bool_or(key IN ('razorpay_key_id', 'RAZORPAY_KEY_ID') AND nullif(trim(value), '') IS NOT NULL), false)
  INTO v_fuel
  FROM public.admin_settings
  WHERE key IN ('razorpay_key_id', 'RAZORPAY_KEY_ID', 'razorpay_key_secret', 'RAZORPAY_KEY_SECRET');

  RETURN jsonb_build_object(
    'relay_call', COALESCE(v_twilio, false),
    'sos_sms', COALESCE(v_sms, false),
    'fuel_checkout', COALESCE(v_fuel, false),
    'ios_background_location', false,
    'share_link_ttl_hours', 2
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleaner_city_runtime_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleaner_city_runtime_capabilities() TO authenticated;
