-- ============================================================
-- Audit Phase 0 — break-glass / auth hardening
-- 1) Cron RPC is_admin + REVOKE FROM PUBLIC
-- 2) payment_records: revoke client INSERT (SECURITY DEFINER / service only)
-- 3) PNQ wake-up trigger: use vault service_role (not anon JWT)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cron management RPCs — admin-only when called as authenticated
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enable_cron_job(p_jobid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;
  UPDATE cron.job SET active = true WHERE jobid = p_jobid;
  BEGIN
    INSERT INTO public.audit_log (action, actor_id, target_type, target_id, metadata)
    VALUES (
      'cron_enable',
      auth.uid(),
      'cron_job',
      p_jobid::text,
      jsonb_build_object('jobid', p_jobid)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.disable_cron_job(p_jobid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;
  UPDATE cron.job SET active = false WHERE jobid = p_jobid;
  BEGIN
    INSERT INTO public.audit_log (action, actor_id, target_type, target_id, metadata)
    VALUES (
      'cron_disable',
      auth.uid(),
      'cron_job',
      p_jobid::text,
      jsonb_build_object('jobid', p_jobid)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_cron_schedule(p_jobid bigint, p_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;
  IF p_schedule IS NULL OR length(trim(p_schedule)) < 1 THEN
    RAISE EXCEPTION 'Invalid cron schedule';
  END IF;
  UPDATE cron.job SET schedule = p_schedule WHERE jobid = p_jobid;
  BEGIN
    INSERT INTO public.audit_log (action, actor_id, target_type, target_id, metadata)
    VALUES (
      'cron_reschedule',
      auth.uid(),
      'cron_job',
      p_jobid::text,
      jsonb_build_object('jobid', p_jobid, 'schedule', p_schedule)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.enable_cron_job(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.disable_cron_job(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_cron_schedule(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enable_cron_job(bigint) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_cron_job(bigint) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.update_cron_schedule(bigint, text) TO service_role, authenticated;

-- Also lock list/run helpers if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_cron_jobs'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_cron_jobs() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_cron_jobs() TO service_role, authenticated';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. payment_records — no client INSERT of paid/pending rows
--    SECURITY DEFINER paths + service_role bypass RLS.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "System can create payment records" ON public.payment_records;
DROP POLICY IF EXISTS "Buyers can insert payment records" ON public.payment_records;
DROP POLICY IF EXISTS "Users can insert payment records" ON public.payment_records;
DROP POLICY IF EXISTS "Authenticated can insert payment records" ON public.payment_records;

-- Intentionally no INSERT policy for authenticated/anon.
-- Inserts must go through SECURITY DEFINER RPCs / service_role.

COMMENT ON TABLE public.payment_records IS
  'Payment ledger rows. Client INSERT revoked (audit P0). Only SECURITY DEFINER RPCs and service_role may insert.';

-- ------------------------------------------------------------
-- 3. PNQ wake trigger — authorize with vault service_role key
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  did_claim boolean := false;
  v_url text;
  v_service_key text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(87201401) THEN
    RETURN NEW;
  END IF;

  UPDATE public._pnq_wakeup_gate
  SET last_wakeup_at = now()
  WHERE id = 1
    AND last_wakeup_at < now() - interval '2 seconds'
  RETURNING true INTO did_claim;

  IF NOT COALESCE(did_claim, false) THEN
    RETURN NEW;
  END IF;

  v_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ) || '/functions/v1/process-notification-queue';

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_service_key IS NULL OR length(v_service_key) < 20 THEN
    v_service_key := current_setting('app.settings.service_role_key', true);
  END IF;

  IF v_service_key IS NULL OR length(v_service_key) < 20 THEN
    RAISE WARNING 'trigger_process_notification_queue: service_role key missing — skip wake';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('trigger', 'insert_debounced', 'time', now())
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
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trigger_process_notification_queue() IS
  'Debounced PNQ wake-up using vault/service_role Authorization (audit P0 — never anon).';

-- ------------------------------------------------------------
-- 4. Safety cron wake — same service_role auth (not hardcoded anon JWT)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_wakeup_notification_queue_if_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  did_claim boolean := false;
  v_url text;
  v_service_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.notification_queue
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
  ) THEN
    RETURN;
  END IF;

  UPDATE public._pnq_wakeup_gate
  SET last_wakeup_at = now()
  WHERE id = 1
    AND last_wakeup_at < now() - interval '15 seconds'
  RETURNING true INTO did_claim;

  IF NOT COALESCE(did_claim, false) THEN
    RETURN;
  END IF;

  v_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ) || '/functions/v1/process-notification-queue';

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_service_key IS NULL OR length(v_service_key) < 20 THEN
    v_service_key := current_setting('app.settings.service_role_key', true);
  END IF;

  IF v_service_key IS NULL OR length(v_service_key) < 20 THEN
    RAISE WARNING 'fn_wakeup_notification_queue_if_pending: service_role key missing — skip wake';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('trigger', 'cron_pending_safety', 'time', now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_wakeup_notification_queue_if_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_wakeup_notification_queue_if_pending() TO service_role;
