-- WhatsApp multi-provider support (Meta default + optional Evolution Go).
-- Does not change active provider away from meta.
-- Does not create a parallel order notification outbox.

-- ---------------------------------------------------------------------------
-- 1) Provider config (singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_provider_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active_provider text NOT NULL DEFAULT 'meta'
    CHECK (active_provider IN ('meta', 'evolution_go')),
  evolution_mode text NOT NULL DEFAULT 'disabled'
    CHECK (evolution_mode IN ('disabled', 'dry_run', 'live')),
  -- Readiness gates required before live Evolution activation
  readiness_connected boolean NOT NULL DEFAULT false,
  readiness_health_ok boolean NOT NULL DEFAULT false,
  readiness_session_valid boolean NOT NULL DEFAULT false,
  readiness_test_message_ok boolean NOT NULL DEFAULT false,
  readiness_webhook_ok boolean NOT NULL DEFAULT false,
  readiness_admin_approved boolean NOT NULL DEFAULT false,
  readiness_admin_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  readiness_admin_approved_at timestamptz,
  dry_run_completed_at timestamptz,
  last_kill_switch_at timestamptz,
  last_kill_switch_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.whatsapp_provider_config (id, active_provider, evolution_mode)
VALUES (1, 'meta', 'disabled')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.whatsapp_provider_config IS
  'Singleton WhatsApp provider selection. Meta is production default. Evolution Go is optional.';

ALTER TABLE public.whatsapp_provider_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_provider_config_admin_select ON public.whatsapp_provider_config;
CREATE POLICY whatsapp_provider_config_admin_select
  ON public.whatsapp_provider_config
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- No direct client writes - use SECURITY DEFINER RPCs

-- ---------------------------------------------------------------------------
-- 2) Provider audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_provider_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL
    CHECK (action IN (
      'set_provider',
      'set_mode',
      'kill_switch_meta',
      'readiness_update',
      'admin_approve_live',
      'retry_cross_provider',
      'test_message',
      'connect',
      'disconnect',
      'reconnect'
    )),
  previous_provider text,
  new_provider text,
  previous_mode text,
  new_mode text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_provider_audit_created_idx
  ON public.whatsapp_provider_audit (created_at DESC);

ALTER TABLE public.whatsapp_provider_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_provider_audit_admin_select ON public.whatsapp_provider_audit;
CREATE POLICY whatsapp_provider_audit_admin_select
  ON public.whatsapp_provider_audit
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Evolution Go instance metadata (no API keys / session blobs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communication_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'whatsapp_evolution_go'
    CHECK (channel = 'whatsapp_evolution_go'),
  instance_name text NOT NULL,
  provider_instance_id text,
  connection_status text NOT NULL DEFAULT 'unknown'
    CHECK (connection_status IN (
      'unknown', 'disconnected', 'connecting', 'qr', 'connected', 'error'
    )),
  last_connected_at timestamptz,
  last_health_at timestamptz,
  last_health_ok boolean,
  last_qr_at timestamptz,
  last_error text,
  webhook_configured_at timestamptz,
  connected_phone_masked text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, instance_name)
);

CREATE INDEX IF NOT EXISTS communication_instances_status_idx
  ON public.communication_instances (connection_status);

ALTER TABLE public.communication_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS communication_instances_admin_select ON public.communication_instances;
CREATE POLICY communication_instances_admin_select
  ON public.communication_instances
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4) Webhook event store (dedupe + replay protection)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communication_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'evolution_go'
    CHECK (provider IN ('evolution_go', 'meta')),
  event_dedupe_key text NOT NULL,
  instance_id text,
  event_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed boolean NOT NULL DEFAULT false,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_dedupe_key)
);

CREATE INDEX IF NOT EXISTS communication_webhook_events_received_idx
  ON public.communication_webhook_events (received_at DESC);

ALTER TABLE public.communication_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS communication_webhook_events_admin_select ON public.communication_webhook_events;
CREATE POLICY communication_webhook_events_admin_select
  ON public.communication_webhook_events
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- 5) Extend whatsapp_messages for multi-provider accuracy
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'evolution_go'));

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS provider_message_id text;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS notification_queue_id uuid;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS dry_run boolean NOT NULL DEFAULT false;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS delivery_status_supported boolean NOT NULL DEFAULT true;

-- Allow additional statuses used by adapter / dry-run
ALTER TABLE public.whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN (
    'queued', 'sent', 'delivered', 'read', 'failed', 'received', 'unknown',
    'provider_accepted', 'dry_run', 'skipped', 'unsupported'
  ));

CREATE INDEX IF NOT EXISTS whatsapp_messages_provider_created_idx
  ON public.whatsapp_messages (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_messages_queue_id_idx
  ON public.whatsapp_messages (notification_queue_id)
  WHERE notification_queue_id IS NOT NULL;

COMMENT ON COLUMN public.whatsapp_messages.provider IS
  'Provider used for this attempt. Historical accuracy - never rewrite on provider switch.';
COMMENT ON COLUMN public.whatsapp_messages.delivery_status_supported IS
  'False when provider cannot confirm delivered/read; UI must not invent those statuses.';

-- ---------------------------------------------------------------------------
-- 6) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_evolution_readiness_complete(cfg public.whatsapp_provider_config)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    cfg.readiness_connected
    AND cfg.readiness_health_ok
    AND cfg.readiness_session_valid
    AND cfg.readiness_test_message_ok
    AND cfg.readiness_webhook_ok
    AND cfg.readiness_admin_approved;
$$;

CREATE OR REPLACE FUNCTION public.get_whatsapp_provider_config()
RETURNS public.whatsapp_provider_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.whatsapp_provider_config;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT * INTO v_row FROM public.whatsapp_provider_config WHERE id = 1;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_whatsapp_provider_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_provider_config() TO service_role;

-- ---------------------------------------------------------------------------
-- 7) Atomic provider switch (no silent dual-send)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_whatsapp_provider(
  p_provider text,
  p_mode text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS public.whatsapp_provider_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev public.whatsapp_provider_config;
  v_new public.whatsapp_provider_config;
  v_mode text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_provider NOT IN ('meta', 'evolution_go') THEN
    RAISE EXCEPTION 'invalid provider';
  END IF;

  SELECT * INTO v_prev FROM public.whatsapp_provider_config WHERE id = 1 FOR UPDATE;

  v_mode := COALESCE(p_mode, v_prev.evolution_mode);
  IF v_mode NOT IN ('disabled', 'dry_run', 'live') THEN
    RAISE EXCEPTION 'invalid evolution_mode';
  END IF;

  -- Meta path ignores evolution mode for routing; keep mode as-is unless provided.
  IF p_provider = 'meta' THEN
    v_mode := COALESCE(p_mode, v_prev.evolution_mode);
  END IF;

  -- Refuse live Evolution without full readiness gates
  IF p_provider = 'evolution_go' AND v_mode = 'live' THEN
    IF NOT public.whatsapp_evolution_readiness_complete(v_prev) THEN
      RAISE EXCEPTION 'evolution_go live blocked: readiness gates incomplete (connection, health, session, test message, webhook, admin approval)';
    END IF;
  END IF;

  -- Selecting evolution_go with disabled mode is not useful
  IF p_provider = 'evolution_go' AND v_mode = 'disabled' THEN
    RAISE EXCEPTION 'set evolution_mode to dry_run or live before activating evolution_go';
  END IF;

  UPDATE public.whatsapp_provider_config
  SET
    active_provider = p_provider,
    evolution_mode = CASE
      WHEN p_provider = 'evolution_go' THEN v_mode
      ELSE COALESCE(p_mode, evolution_mode)
    END,
    updated_by = auth.uid(),
    updated_at = now(),
    notes = COALESCE(p_reason, notes)
  WHERE id = 1
  RETURNING * INTO v_new;

  INSERT INTO public.whatsapp_provider_audit (
    action, previous_provider, new_provider, previous_mode, new_mode, actor_id, reason, metadata
  ) VALUES (
    'set_provider',
    v_prev.active_provider,
    v_new.active_provider,
    v_prev.evolution_mode,
    v_new.evolution_mode,
    auth.uid(),
    p_reason,
    jsonb_build_object('source', 'admin_set_whatsapp_provider')
  );

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_whatsapp_provider(text, text, text) TO authenticated;

-- Immediate kill switch to Meta (no redeploy)
CREATE OR REPLACE FUNCTION public.admin_rollback_whatsapp_provider_to_meta(
  p_reason text DEFAULT 'kill_switch'
)
RETURNS public.whatsapp_provider_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev public.whatsapp_provider_config;
  v_new public.whatsapp_provider_config;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT * INTO v_prev FROM public.whatsapp_provider_config WHERE id = 1 FOR UPDATE;

  UPDATE public.whatsapp_provider_config
  SET
    active_provider = 'meta',
    last_kill_switch_at = now(),
    last_kill_switch_by = auth.uid(),
    updated_by = auth.uid(),
    updated_at = now(),
    notes = COALESCE(p_reason, notes)
  WHERE id = 1
  RETURNING * INTO v_new;

  INSERT INTO public.whatsapp_provider_audit (
    action, previous_provider, new_provider, previous_mode, new_mode, actor_id, reason, metadata
  ) VALUES (
    'kill_switch_meta',
    v_prev.active_provider,
    'meta',
    v_prev.evolution_mode,
    v_new.evolution_mode,
    auth.uid(),
    p_reason,
    jsonb_build_object('source', 'admin_rollback_whatsapp_provider_to_meta')
  );

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_rollback_whatsapp_provider_to_meta(text) TO authenticated;

-- Update readiness flags (service role / admin Edge Function)
CREATE OR REPLACE FUNCTION public.admin_update_whatsapp_evolution_readiness(
  p_connected boolean DEFAULT NULL,
  p_health_ok boolean DEFAULT NULL,
  p_session_valid boolean DEFAULT NULL,
  p_test_message_ok boolean DEFAULT NULL,
  p_webhook_ok boolean DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.whatsapp_provider_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new public.whatsapp_provider_config;
BEGIN
  -- Allow service_role (auth.uid() null) for webhook/worker updates; else admin JWT only.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.whatsapp_provider_config
  SET
    readiness_connected = COALESCE(p_connected, readiness_connected),
    readiness_health_ok = COALESCE(p_health_ok, readiness_health_ok),
    readiness_session_valid = COALESCE(p_session_valid, readiness_session_valid),
    readiness_test_message_ok = COALESCE(p_test_message_ok, readiness_test_message_ok),
    readiness_webhook_ok = COALESCE(p_webhook_ok, readiness_webhook_ok),
    dry_run_completed_at = CASE
      WHEN COALESCE(p_test_message_ok, readiness_test_message_ok)
        AND COALESCE(p_webhook_ok, readiness_webhook_ok)
        AND COALESCE(p_connected, readiness_connected)
        AND COALESCE(p_health_ok, readiness_health_ok)
        AND COALESCE(p_session_valid, readiness_session_valid)
      THEN COALESCE(dry_run_completed_at, now())
      ELSE dry_run_completed_at
    END,
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = 1
  RETURNING * INTO v_new;

  INSERT INTO public.whatsapp_provider_audit (
    action, previous_provider, new_provider, previous_mode, new_mode, actor_id, reason, metadata
  ) VALUES (
    'readiness_update',
    v_new.active_provider,
    v_new.active_provider,
    v_new.evolution_mode,
    v_new.evolution_mode,
    auth.uid(),
    'readiness_update',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'connected', v_new.readiness_connected,
      'health_ok', v_new.readiness_health_ok,
      'session_valid', v_new.readiness_session_valid,
      'test_message_ok', v_new.readiness_test_message_ok,
      'webhook_ok', v_new.readiness_webhook_ok
    )
  );

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_whatsapp_evolution_readiness(
  boolean, boolean, boolean, boolean, boolean, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_whatsapp_evolution_readiness(
  boolean, boolean, boolean, boolean, boolean, jsonb
) TO service_role;

-- Explicit admin approval required for live
CREATE OR REPLACE FUNCTION public.admin_approve_whatsapp_evolution_live(
  p_reason text DEFAULT NULL
)
RETURNS public.whatsapp_provider_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev public.whatsapp_provider_config;
  v_new public.whatsapp_provider_config;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT * INTO v_prev FROM public.whatsapp_provider_config WHERE id = 1 FOR UPDATE;

  IF NOT (
    v_prev.readiness_connected
    AND v_prev.readiness_health_ok
    AND v_prev.readiness_session_valid
    AND v_prev.readiness_test_message_ok
    AND v_prev.readiness_webhook_ok
  ) THEN
    RAISE EXCEPTION 'cannot approve live: connection, health, session, test message and webhook must pass first';
  END IF;

  UPDATE public.whatsapp_provider_config
  SET
    readiness_admin_approved = true,
    readiness_admin_approved_by = auth.uid(),
    readiness_admin_approved_at = now(),
    updated_by = auth.uid(),
    updated_at = now(),
    notes = COALESCE(p_reason, notes)
  WHERE id = 1
  RETURNING * INTO v_new;

  INSERT INTO public.whatsapp_provider_audit (
    action, previous_provider, new_provider, previous_mode, new_mode, actor_id, reason, metadata
  ) VALUES (
    'admin_approve_live',
    v_prev.active_provider,
    v_prev.active_provider,
    v_prev.evolution_mode,
    v_prev.evolution_mode,
    auth.uid(),
    p_reason,
    '{}'::jsonb
  );

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_whatsapp_evolution_live(text) TO authenticated;

-- Explicit cross-provider retry audit (admin only; does not auto-reroute failures)
CREATE OR REPLACE FUNCTION public.admin_audit_whatsapp_cross_provider_retry(
  p_notification_queue_id uuid,
  p_from_provider text,
  p_to_provider text,
  p_reason text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  INSERT INTO public.whatsapp_provider_audit (
    action, previous_provider, new_provider, actor_id, reason, metadata
  ) VALUES (
    'retry_cross_provider',
    p_from_provider,
    p_to_provider,
    auth.uid(),
    p_reason,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'notification_queue_id', p_notification_queue_id
    )
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_audit_whatsapp_cross_provider_retry(
  uuid, text, text, text, jsonb
) TO authenticated;

-- Ops dashboard aggregates (admin)
CREATE OR REPLACE FUNCTION public.admin_whatsapp_delivery_stats(
  p_since timestamptz DEFAULT (now() - interval '24 hours'),
  p_provider text DEFAULT NULL
)
RETURNS TABLE (
  provider text,
  status text,
  dry_run boolean,
  cnt bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    wm.provider,
    wm.status,
    wm.dry_run,
    count(*)::bigint AS cnt
  FROM public.whatsapp_messages wm
  WHERE wm.created_at >= p_since
    AND (p_provider IS NULL OR wm.provider = p_provider)
  GROUP BY wm.provider, wm.status, wm.dry_run
  ORDER BY wm.provider, wm.status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_whatsapp_delivery_stats(timestamptz, text) TO authenticated;
