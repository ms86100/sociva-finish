
-- Step 1: Update trigger function with pg_sleep to mitigate race condition
CREATE OR REPLACE FUNCTION public.trigger_process_notification_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Small delay so the INSERT transaction commits before the edge function queries
  PERFORM pg_sleep(0.5);

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
