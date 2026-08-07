-- Ops gap: send-booking-reminders edge fn existed but was never scheduled.
-- Appointment windows are ~10 minutes wide (1h / 30m / 10m); run every 5 minutes.
-- Matches existing HTTP cron pattern (monitor-stalled-deliveries).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'send_booking_reminders_every_5m',
      'send-booking-reminders'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'send_booking_reminders_every_5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/send-booking-reminders',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);
