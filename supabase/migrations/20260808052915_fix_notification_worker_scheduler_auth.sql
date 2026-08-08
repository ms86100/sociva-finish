-- Authenticate pg_net PNQ wake-ups with a dedicated scheduler secret.
-- The Edge gateway has verify_jwt=false, while the function body requires this
-- x-cron-secret (or service-role/admin auth). The secret value stays in Vault.

CREATE OR REPLACE FUNCTION public.fn_invoke_notification_worker(p_trigger text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_worker_secret text;
BEGIN
  v_url := rtrim(coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ), '/') || '/functions/v1/process-notification-queue';

  SELECT decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pnq_worker_secret'
  LIMIT 1;

  IF v_worker_secret IS NULL OR length(v_worker_secret) < 32 THEN
    RAISE WARNING 'fn_invoke_notification_worker: pnq_worker_secret missing — skip wake';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_worker_secret
    ),
    body := jsonb_build_object('trigger', p_trigger, 'time', now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_invoke_notification_worker(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_invoke_notification_worker(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  did_claim boolean := false;
BEGIN
  IF NOT pg_try_advisory_xact_lock(87201401) THEN
    RETURN NEW;
  END IF;

  UPDATE public._pnq_wakeup_gate
  SET last_wakeup_at = now()
  WHERE id = 1
    AND last_wakeup_at < now() - interval '2 seconds'
  RETURNING true INTO did_claim;

  IF COALESCE(did_claim, false) THEN
    PERFORM public.fn_invoke_notification_worker('insert_debounced');
  END IF;
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

CREATE OR REPLACE FUNCTION public.fn_wakeup_notification_queue_if_pending()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  did_claim boolean := false;
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

  IF COALESCE(did_claim, false) THEN
    PERFORM public.fn_invoke_notification_worker('cron_pending_safety');
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_wakeup_notification_queue_if_pending()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wakeup_notification_queue_if_pending()
  TO service_role;
