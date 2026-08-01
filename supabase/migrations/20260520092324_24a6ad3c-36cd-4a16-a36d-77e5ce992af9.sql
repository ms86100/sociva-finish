-- 1. Drop the duplicate INSERT trigger on notification_queue (fires same fn as trg_process_notification_queue)
DROP TRIGGER IF EXISTS trg_process_notification_queue_realtime ON public.notification_queue;

-- 2. Unschedule the per-minute cron sweep for push delivery.
--    The notification-engine cron (jobid 9) is unrelated (digests/reminders) and is preserved.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process_notifications_every_minute') THEN
    PERFORM cron.unschedule('process_notifications_every_minute');
  END IF;
END $$;

-- 3. Harden the realtime trigger: log failures so we can see them without cron coverage.
CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://kkzkuyhgdvyecmxtmkpy.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtremt1eWhnZHZ5ZWNteHRta3B5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzIyMTEsImV4cCI6MjA4OTQwODIxMX0.-dmjGjRYs7u8TkR14oPwOXWipNXgSxZRjuwc6q98VkA'
    ),
    body := jsonb_build_object('trigger', 'insert', 'queue_id', NEW.id, 'time', now())
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron is gone, so make trigger failures observable.
  BEGIN
    INSERT INTO public.push_logs (user_id, level, message, metadata)
    VALUES (
      NEW.user_id,
      'error',
      'trigger_process_notification_queue net.http_post failed',
      jsonb_build_object('queue_id', NEW.id, 'sqlerrm', SQLERRM)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$function$;