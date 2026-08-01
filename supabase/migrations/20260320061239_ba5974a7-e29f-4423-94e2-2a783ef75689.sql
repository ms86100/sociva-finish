
-- Blocker 1: Add stuck-processing recovery to claim_notification_queue
CREATE OR REPLACE FUNCTION public.claim_notification_queue(batch_size int DEFAULT 50)
RETURNS SETOF notification_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Recovery: reset items stuck in 'processing' for >3 minutes (edge function crash recovery)
  UPDATE public.notification_queue
  SET status = 'pending', processed_at = NULL
  WHERE status = 'processing'
    AND processed_at < now() - interval '3 minutes';

  -- Claim pending items atomically
  RETURN QUERY
  UPDATE public.notification_queue
  SET status = 'processing', processed_at = now()
  WHERE id IN (
    SELECT id FROM public.notification_queue
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Blocker 2: Remove pg_sleep(0.5) from trigger — it blocks the INSERT transaction
CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://ywhlqsgvbkvcvqlsniad.supabase.co/functions/v1/process-notification-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3aGxxc2d2Ymt2Y3ZxbHNuaWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3OTY1NDEsImV4cCI6MjA4ODM3MjU0MX0.uBtwDdGBgdb3KRYPptfBV1plydCnnRq1KNLH5xVlkjI'
    ),
    body := jsonb_build_object('trigger', true, 'time', now())
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trigger_process_notification_queue failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
