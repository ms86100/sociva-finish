-- Add expires_at to notification_queue to prevent stale rows from being delivered.
-- Default: 24 hours from creation. Rows that expire are silently discarded by the worker.
-- Also add created_at to the claim function's eligibility filter.

ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
  DEFAULT (now() + interval '24 hours');

-- Back-fill: any existing pending/failed rows that are already older than 24 h should expire now.
UPDATE public.notification_queue
SET expires_at = now() - interval '1 second'
WHERE status IN ('pending', 'failed')
  AND created_at < now() - interval '24 hours';

-- Index so the claim RPC can cheaply skip expired rows.
CREATE INDEX IF NOT EXISTS idx_notification_queue_expires_at
  ON public.notification_queue (expires_at)
  WHERE status IN ('pending', 'failed');
