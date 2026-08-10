-- Add action tracking columns to notification tables
-- This enables distinguishing informational vs actionable notifications
-- and tracking whether required actions have been completed

-- Add action tracking to notification_queue
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS action_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS action_completed timestamptz NULL,
  ADD COLUMN IF NOT EXISTS event_created_at timestamptz NULL;

-- Add action tracking to user_notifications  
ALTER TABLE public.user_notifications
  ADD COLUMN IF NOT EXISTS action_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS action_completed timestamptz NULL,
  ADD COLUMN IF NOT EXISTS event_created_at timestamptz NULL;

-- Add indexes for common queries on action status
CREATE INDEX IF NOT EXISTS idx_notification_queue_action_required 
  ON public.notification_queue (action_required) 
  WHERE action_required = true AND action_completed IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_notifications_action_required
  ON public.user_notifications (action_required) 
  WHERE action_required = true AND action_completed IS NULL;

-- Update any existing notification queue items to set event_created_at = created_at
-- for backward compatibility
UPDATE public.notification_queue
SET event_created_at = created_at
WHERE event_created_at IS NULL;

-- Update any existing user notifications to set event_created_at = created_at
-- for backward compatibility
UPDATE public.user_notifications
SET event_created_at = created_at
WHERE event_created_at IS NULL;

COMMENT ON COLUMN public.notification_queue.action_required IS 'Whether this notification requires a user action';
COMMENT ON COLUMN public.notification_queue.action_completed IS 'Timestamp when the required action was completed';
COMMENT ON COLUMN public.notification_queue.event_created_at IS 'When the underlying event actually occurred';

COMMENT ON COLUMN public.user_notifications.action_required IS 'Whether this notification requires a user action';
COMMENT ON COLUMN public.user_notifications.action_completed IS 'Timestamp when the required action was completed';
COMMENT ON COLUMN public.user_notifications.event_created_at IS 'When the underlying event actually occurred';
