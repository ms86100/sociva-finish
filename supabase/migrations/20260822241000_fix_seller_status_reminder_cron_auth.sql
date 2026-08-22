-- Fix seller status reminder cron: vault has no supabase_url secret in prod.

CREATE OR REPLACE FUNCTION public.fn_invoke_seller_status_reminders(p_trigger text DEFAULT 'cron')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_service_key text;
BEGIN
  v_url := rtrim(coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ), '/') || '/functions/v1/send-seller-status-reminders';

  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_service_key IS NULL OR length(v_service_key) < 32 THEN
    RAISE WARNING 'fn_invoke_seller_status_reminders: service_role_key missing — skip';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('trigger', p_trigger, 'time', now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_invoke_seller_status_reminders(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_invoke_seller_status_reminders(text)
  TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'send_seller_status_reminders_every_5m',
      'send-seller-status-reminders'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'send_seller_status_reminders_every_5m',
  '*/5 * * * *',
  $$SELECT public.fn_invoke_seller_status_reminders('cron');$$
);
