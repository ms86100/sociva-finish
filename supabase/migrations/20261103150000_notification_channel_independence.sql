-- Channel-independent delivery tracking for notification_queue.
-- Fixes adversarial F1/F2 foundations: WhatsApp success must not be resent on push retry.
-- Meta remains default WhatsApp provider; no Evolution production activation in this migration.

-- ---------------------------------------------------------------------------
-- 1) Per-channel status on the shared queue row (independent recoverability)
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS whatsapp_status text
    CHECK (whatsapp_status IS NULL OR whatsapp_status IN (
      'pending', 'processing', 'skipped', 'sent', 'provider_accepted',
      'failed', 'dry_run'
    ));

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS whatsapp_provider text
    CHECK (whatsapp_provider IS NULL OR whatsapp_provider IN ('meta', 'evolution_go'));

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS whatsapp_provider_message_id text;

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS whatsapp_error text;

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS whatsapp_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS whatsapp_updated_at timestamptz;

COMMENT ON COLUMN public.notification_queue.whatsapp_status IS
  'Independent WhatsApp channel status. Push retries must not reset a successful WhatsApp status.';

-- Successful WhatsApp terminal states for skip logic
-- (sent = Meta style; provider_accepted = Evolution HTTP accept)

-- ---------------------------------------------------------------------------
-- 2) DB claim: only one worker may attempt WhatsApp unless force retry
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_whatsapp_channel_delivery(
  p_queue_id uuid,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.notification_queue;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row
  FROM public.notification_queue
  WHERE id = p_queue_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Already succeeded: never claim again unless explicit force (audited admin retry)
  IF NOT p_force AND v_row.whatsapp_status IN ('sent', 'provider_accepted') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'already_succeeded',
      'whatsapp_status', v_row.whatsapp_status,
      'whatsapp_provider', v_row.whatsapp_provider,
      'whatsapp_provider_message_id', v_row.whatsapp_provider_message_id
    );
  END IF;

  -- Skip dry_run success as "done" for live skips; force can re-run
  IF NOT p_force AND v_row.whatsapp_status = 'dry_run' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'already_dry_run',
      'whatsapp_status', v_row.whatsapp_status
    );
  END IF;

  -- Another worker recently claimed (60s processing lease)
  IF NOT p_force
     AND v_row.whatsapp_status = 'processing'
     AND v_row.whatsapp_updated_at IS NOT NULL
     AND v_row.whatsapp_updated_at > (v_now - interval '60 seconds') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'in_progress');
  END IF;

  UPDATE public.notification_queue
  SET
    whatsapp_status = 'processing',
    whatsapp_attempt_count = COALESCE(whatsapp_attempt_count, 0) + 1,
    whatsapp_updated_at = v_now,
    whatsapp_error = CASE WHEN p_force THEN NULL ELSE whatsapp_error END
  WHERE id = p_queue_id;

  RETURN jsonb_build_object(
    'ok', true,
    'reason', 'claimed',
    'force', p_force,
    'attempt_count', COALESCE(v_row.whatsapp_attempt_count, 0) + 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_whatsapp_channel_delivery(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_whatsapp_channel_delivery(
  p_queue_id uuid,
  p_status text,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN (
    'skipped', 'sent', 'provider_accepted', 'failed', 'dry_run', 'pending'
  ) THEN
    RAISE EXCEPTION 'invalid whatsapp status %', p_status;
  END IF;

  UPDATE public.notification_queue
  SET
    whatsapp_status = p_status,
    whatsapp_provider = COALESCE(p_provider, whatsapp_provider),
    whatsapp_provider_message_id = COALESCE(p_provider_message_id, whatsapp_provider_message_id),
    whatsapp_error = p_error,
    whatsapp_updated_at = now(),
    delivery_evidence = COALESCE(delivery_evidence, '{}'::jsonb) || jsonb_build_object(
      'whatsapp', jsonb_build_object(
        'provider', COALESCE(p_provider, whatsapp_provider),
        'status', p_status,
        'provider_message_id', COALESCE(p_provider_message_id, whatsapp_provider_message_id),
        'error', p_error,
        'updated_at', now(),
        'delivery_confirmed', false
      )
    )
  WHERE id = p_queue_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_whatsapp_channel_delivery(uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Unique safeguard: at most one successful live outbound WA per queue item
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_success_once_per_queue
  ON public.whatsapp_messages (notification_queue_id)
  WHERE direction = 'outbound'
    AND notification_queue_id IS NOT NULL
    AND dry_run = false
    AND status IN ('sent', 'provider_accepted', 'delivered', 'read');

-- ---------------------------------------------------------------------------
-- 4) Instance must be admin-registered before webhook acceptance (F7)
-- ---------------------------------------------------------------------------
ALTER TABLE public.communication_instances
  ADD COLUMN IF NOT EXISTS webhook_trusted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.communication_instances.webhook_trusted IS
  'Admin-approved instance. Untrusted instances are rejected by the Evolution webhook.';

-- ---------------------------------------------------------------------------
-- 5) Idempotent admin WhatsApp-only retry audit helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_request_whatsapp_only_retry(
  p_notification_queue_id uuid,
  p_reason text DEFAULT NULL,
  p_to_provider text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.notification_queue;
  v_cfg public.whatsapp_provider_config;
  v_to text;
  v_audit_id uuid;
  v_key text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT * INTO v_row FROM public.notification_queue WHERE id = p_notification_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification queue item not found';
  END IF;

  SELECT * INTO v_cfg FROM public.whatsapp_provider_config WHERE id = 1;
  v_to := COALESCE(p_to_provider, v_cfg.active_provider, 'meta');

  v_key := COALESCE(
    NULLIF(trim(p_idempotency_key), ''),
    md5(p_notification_queue_id::text || ':' || v_to || ':' || COALESCE(p_reason, '') || ':' || date_trunc('minute', now())::text)
  );

  -- Duplicate admin click within same minute+reason+provider: no-op
  IF EXISTS (
    SELECT 1 FROM public.whatsapp_provider_audit a
    WHERE a.action = 'retry_cross_provider'
      AND a.metadata->>'notification_queue_id' = p_notification_queue_id::text
      AND a.metadata->>'idempotency_key' = v_key
      AND a.created_at > now() - interval '10 minutes'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_retry_request', 'idempotency_key', v_key);
  END IF;

  -- Reset WhatsApp channel only - never touch push status / processed_at
  UPDATE public.notification_queue
  SET
    whatsapp_status = 'pending',
    whatsapp_error = NULL,
    whatsapp_updated_at = now(),
    payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
      'force_whatsapp_retry', true,
      'whatsapp_retry_requested_at', now(),
      'whatsapp_retry_to_provider', v_to
    )
  WHERE id = p_notification_queue_id;

  INSERT INTO public.whatsapp_provider_audit (
    action, previous_provider, new_provider, actor_id, reason, metadata
  ) VALUES (
    'retry_cross_provider',
    v_row.whatsapp_provider,
    v_to,
    auth.uid(),
    COALESCE(p_reason, 'whatsapp_only_retry'),
    jsonb_build_object(
      'notification_queue_id', p_notification_queue_id,
      'idempotency_key', v_key,
      'whatsapp_only', true,
      'push_untouched', true,
      'queue_status_unchanged', v_row.status
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'audit_id', v_audit_id,
    'idempotency_key', v_key,
    'to_provider', v_to,
    'queue_status', v_row.status,
    'note', 'WhatsApp channel reset only. Push status was not modified.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_request_whatsapp_only_retry(uuid, text, text, text) TO authenticated;
