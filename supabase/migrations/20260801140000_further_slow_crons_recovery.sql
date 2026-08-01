-- Temporary recovery: further cut cron load while free-tier Postgres recovers.
-- Prior: reminders/monitor every 10m; SLA every 15m.
-- Still seeing statement timeouts + Auth 504s on /token (DB-backed).
-- Keep product-safe: delay reminders/SLA/monitor; trigger-based notifications unchanged.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'fire_due_reminders_every_10m',
      'fire_due_reminders_every_30m',
      'monitor_stalled_deliveries_every_10m',
      'monitor_stalled_deliveries_every_30m',
      'check_dispute_sla_every_15m',
      'check_dispute_sla_every_30m',
      'check-support-sla',
      'check-support-sla_every_30m'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- Reminders: 10m/100 → 30m/50
SELECT cron.schedule(
  'fire_due_reminders_every_30m',
  '*/30 * * * *',
  $cron$ SELECT public.fn_fire_due_reminders(50); $cron$
);

-- Stalled deliveries: 10m → 30m (HTTP/pg_net)
SELECT cron.schedule(
  'monitor_stalled_deliveries_every_30m',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/monitor-stalled-deliveries',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);

-- Dispute SLA: 15m → 30m
SELECT cron.schedule(
  'check_dispute_sla_every_30m',
  '*/30 * * * *',
  $cron$
  SELECT fn_check_dispute_sla_breach();
  $cron$
);

-- Support SLA: 15m → 30m
SELECT cron.schedule(
  'check-support-sla_every_30m',
  '*/30 * * * *',
  $cron$ SELECT public.fn_check_support_sla(); $cron$
);
