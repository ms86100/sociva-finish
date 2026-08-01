
-- C5: Add queue_item_id to user_notifications for retry deduplication
ALTER TABLE public.user_notifications
ADD COLUMN IF NOT EXISTS queue_item_id uuid;

-- Unique constraint: one in-app notification per queue item
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_notifications_queue_item_id
ON public.user_notifications (queue_item_id)
WHERE queue_item_id IS NOT NULL;
