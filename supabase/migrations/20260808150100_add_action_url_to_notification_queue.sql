-- notification_queue was missing action_url; dualNotificationColumns() writes both columns.
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS action_url text;
