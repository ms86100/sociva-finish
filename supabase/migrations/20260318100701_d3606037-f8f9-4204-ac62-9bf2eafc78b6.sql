
CREATE OR REPLACE FUNCTION trigger_process_notification_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
END;
$$;
