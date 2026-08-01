-- Real-time notification processing: trigger edge function immediately on queue insert
-- The cron job remains as a safety net for any missed items

CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Fire-and-forget HTTP call to process the queue immediately
  PERFORM net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body := '{}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the insert if the HTTP call fails; cron will pick it up
  RAISE WARNING 'Failed to trigger notification processing: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_notification_queue_realtime ON public.notification_queue;
CREATE TRIGGER trg_process_notification_queue_realtime
  AFTER INSERT ON public.notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_process_notification_queue();