-- Phase 2–4 notification remediation:
-- quiet hours, DLQ, device token health, WA hard opt-in backfill, PNQ trigger URL verify/fix,
-- server lifecycle helpers (create already via queue; supersede/expire RPCs).

-- ── 1. Quiet hours on notification_preferences ──────────────────────────────
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start smallint NOT NULL DEFAULT 22
    CHECK (quiet_hours_start >= 0 AND quiet_hours_start <= 23),
  ADD COLUMN IF NOT EXISTS quiet_hours_end smallint NOT NULL DEFAULT 7
    CHECK (quiet_hours_end >= 0 AND quiet_hours_end <= 23),
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

COMMENT ON COLUMN public.notification_preferences.quiet_hours_enabled IS
  'When true, non-urgent push is suppressed during quiet_hours_start..quiet_hours_end (local tz). High-priority seller/payment alerts still deliver.';

-- ── 2. WhatsApp hard Meta opt-in: grandfather soft opt-ins ───────────────────
-- Users who already have whatsapp enabled (or never opted out) get an opt-in
-- timestamp so enforcing whatsapp_opted_in_at does not break existing recipients.
UPDATE public.notification_preferences
SET whatsapp_opted_in_at = COALESCE(whatsapp_opted_in_at, updated_at, now())
WHERE whatsapp IS DISTINCT FROM false
  AND whatsapp_opted_in_at IS NULL;

-- ── 3. Device token health scoring ──────────────────────────────────────────
ALTER TABLE public.device_tokens
  ADD COLUMN IF NOT EXISTS health_score smallint NOT NULL DEFAULT 100
    CHECK (health_score >= 0 AND health_score <= 100),
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_device_tokens_health
  ON public.device_tokens (user_id, invalid, health_score DESC);

-- ── 4. Dead-letter queue for exhausted PNQ failures ─────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_dead_letter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_item_id uuid,
  user_id uuid,
  type text,
  title text,
  body text,
  reference_path text,
  payload jsonb DEFAULT '{}'::jsonb,
  retry_count integer,
  last_error text,
  push_skip_reason text,
  failed_at timestamptz NOT NULL DEFAULT now(),
  inspected_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_notification_dlq_failed_at
  ON public.notification_dead_letter (failed_at DESC);

ALTER TABLE public.notification_dead_letter ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read notification DLQ" ON public.notification_dead_letter;
CREATE POLICY "Admins can read notification DLQ"
  ON public.notification_dead_letter
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.notification_dead_letter IS
  'Sustained PNQ failures after max retries. Inspect: SELECT * FROM notification_dead_letter ORDER BY failed_at DESC LIMIT 50;';

-- ── 5. Notification config (rate limits + feature flags) ────────────────────
CREATE TABLE IF NOT EXISTS public.notification_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage notification_config" ON public.notification_config;
CREATE POLICY "Admins manage notification_config"
  ON public.notification_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.notification_config (key, value) VALUES
  ('push_rate_limit', '{"max_per_user_per_hour": 60, "window_seconds": 3600}'::jsonb),
  ('quiet_hours_defaults', '{"start": 22, "end": 7, "timezone": "Asia/Kolkata"}'::jsonb),
  ('token_prune', '{"min_health_score": 10, "max_consecutive_failures": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── 6. Server lifecycle: expire (mark-read) by order ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_expire_order_notifications(
  p_order_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.user_notifications un
  SET is_read = true
  WHERE un.is_read = false
    AND (p_user_id IS NULL OR un.user_id = p_user_id)
    AND (
      (un.data->>'order_id') = p_order_id::text
      OR (un.data->>'orderId') = p_order_id::text
      OR (un.data->>'entity_id') = p_order_id::text
      OR (un.payload->>'order_id') = p_order_id::text
      OR (un.payload->>'orderId') = p_order_id::text
      OR COALESCE(un.action_url, un.reference_path, '') LIKE '%/orders/' || p_order_id::text || '%'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_supersede_order_notifications(
  p_order_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.fn_expire_order_notifications(p_order_id, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_expire_order_notifications(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_supersede_order_notifications(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_expire_order_notifications(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_supersede_order_notifications(uuid, uuid) TO authenticated, service_role;

-- ── 7. Verify / fix live PNQ INSERT trigger URL ─────────────────────────────
-- Live function is trigger_process_notification_queue (not a duplicate name).
-- Reaffirm correct project URL; log failures to push_logs when present.
CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA'
    ),
    body := jsonb_build_object('trigger', 'insert', 'queue_id', NEW.id, 'time', now())
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO public.push_logs (user_id, level, message, metadata)
    VALUES (
      NEW.user_id,
      'error',
      'trigger_process_notification_queue net.http_post failed',
      jsonb_build_object('queue_id', NEW.id, 'sqlerrm', SQLERRM)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$function$;

-- Ensure single INSERT trigger name matches production
DROP TRIGGER IF EXISTS trg_invoke_process_notification_queue ON public.notification_queue;
DROP TRIGGER IF EXISTS trg_process_notification_queue_realtime ON public.notification_queue;
DROP TRIGGER IF EXISTS trg_process_notification_queue ON public.notification_queue;
CREATE TRIGGER trg_process_notification_queue
  AFTER INSERT ON public.notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_process_notification_queue();

COMMENT ON FUNCTION public.trigger_process_notification_queue() IS
  'Best-effort trigger→HTTP to PNQ on project kkzkuyhgdvyecmxtmkpy. Optional lightweight outbox NOT added: PNQ self-schedule + orphan recovery already cover missed invokes. Revisit only if sustained trigger failures appear in push_logs.';
