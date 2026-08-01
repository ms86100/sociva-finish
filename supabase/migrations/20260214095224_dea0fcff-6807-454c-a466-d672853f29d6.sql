-- GA BLOCKER 2: Notification queue reliability columns
ALTER TABLE public.notification_queue 
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- Index for retry processing: pick pending/retryable items efficiently
CREATE INDEX idx_notification_queue_retry 
ON public.notification_queue (status, next_retry_at) 
WHERE status IN ('pending', 'retrying');

-- Index for health monitoring: oldest unprocessed
CREATE INDEX idx_notification_queue_pending_age 
ON public.notification_queue (created_at) 
WHERE status = 'pending';