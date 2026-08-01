ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS push_attempted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_success_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS push_fail_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS push_skip_reason text;

CREATE INDEX IF NOT EXISTS idx_notification_queue_push_skip_reason
  ON public.notification_queue (push_skip_reason)
  WHERE push_skip_reason IS NOT NULL;