-- Permanent Free-tier stability: cut cron hammering that saturates Postgres.
-- Evidence: statement timeouts, cron startup timeouts, connection resets;
-- job 11 = fn_fire_due_reminders(500) every 1m; jobs 6/10 = HTTP crons every 2m.
--
-- Changes:
-- 1) Unschedule auto-cancel (edge target is disabled no-op; wasted pg_net + connections)
-- 2) Slow fire_due_reminders: 1m/500 → 10m/100
-- 3) Slow monitor-stalled-deliveries: 2m → 10m
-- 4) Keep process_notifications_every_minute unscheduled (insert trigger + self-invoke)

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IN (
            'auto_cancel_orders_every_2m',
            'auto-cancel-orders',
            'auto_cancel_orders',
            'process_notifications_every_minute',
            'notification_engine_every_1m',
            'fire_due_reminders_every_1m',
            'fire_due_reminders_every_5m',
            'fire_due_reminders_every_10m',
            'monitor_stalled_deliveries_every_2m',
            'monitor_stalled_deliveries_every_5m',
            'monitor_stalled_deliveries_every_10m'
          )
       OR command ILIKE '%auto-cancel-orders%'
       OR command ILIKE '%fn_fire_due_reminders%'
       OR command ILIKE '%monitor-stalled-deliveries%'
       OR command ILIKE '%/notification-engine%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- Reminders: every 10 minutes, smaller batch
SELECT cron.schedule(
  'fire_due_reminders_every_10m',
  '*/10 * * * *',
  $cron$ SELECT public.fn_fire_due_reminders(100); $cron$
);

-- Stalled deliveries: every 10 minutes
SELECT cron.schedule(
  'monitor_stalled_deliveries_every_10m',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/monitor-stalled-deliveries',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);
