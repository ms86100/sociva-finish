-- Every 5 minutes: remind sellers to advance orders stuck in "accepted".

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
  $$
  SELECT net.http_post(
    url := rtrim(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1),
      '/'
    ) || '/functions/v1/send-seller-status-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
      )
    ),
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);
