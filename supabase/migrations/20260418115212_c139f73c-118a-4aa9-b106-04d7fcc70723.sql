DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor_stalled_deliveries_every_5m') THEN
    PERFORM cron.unschedule('monitor_stalled_deliveries_every_5m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification_engine_every_1m') THEN
    PERFORM cron.unschedule('notification_engine_every_1m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monitor_stalled_deliveries_every_2m') THEN
    PERFORM cron.unschedule('monitor_stalled_deliveries_every_2m');
  END IF;
END $$;

SELECT cron.schedule(
  'notification_engine_every_1m',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/notification-engine',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'monitor_stalled_deliveries_every_2m',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/monitor-stalled-deliveries',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);