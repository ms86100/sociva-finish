
-- Fix the cron job to use service_role key instead of anon key
SELECT cron.unschedule('process-notification-queue');

SELECT cron.schedule(
  'process-notification-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rvvctaikytfeyzkwoqxg.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
