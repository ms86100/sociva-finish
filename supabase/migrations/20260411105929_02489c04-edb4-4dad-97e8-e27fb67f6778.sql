
-- 1. Reset stuck processing notifications back to pending
UPDATE notification_queue
SET status = 'pending', updated_at = now(), retry_count = LEAST(retry_count + 1, 8)
WHERE status = 'processing' AND updated_at < now() - interval '2 minutes';

-- 2. Schedule cron job to process notification queue every minute
SELECT cron.schedule(
  'process_notifications_every_minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/process-notification-queue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);

-- 3. Fix the stalled deliveries cron to use correct project URL
SELECT cron.unschedule('monitor_stalled_deliveries_every_5m');
SELECT cron.schedule(
  'monitor_stalled_deliveries_every_5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/monitor-stalled-deliveries',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);

-- 4. Add cron for dispute SLA breach checking (every 15 minutes)
SELECT cron.schedule(
  'check_dispute_sla_every_15m',
  '*/15 * * * *',
  $$
  SELECT fn_check_dispute_sla_breach();
  $$
);

-- 5. Add cron for auto-cancel-orders (every 2 minutes)
SELECT cron.schedule(
  'auto_cancel_orders_every_2m',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/auto-cancel-orders',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA"}'::jsonb,
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  ) AS request_id;
  $$
);
