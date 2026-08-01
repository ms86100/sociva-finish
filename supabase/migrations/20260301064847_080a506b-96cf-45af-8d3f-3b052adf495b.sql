-- Fix 1: Drop the redundant trigger that duplicates placed/enquired seller notifications
DROP TRIGGER IF EXISTS trg_enqueue_order_placed_notification ON public.orders;
DROP FUNCTION IF EXISTS public.enqueue_order_placed_notification();

-- Fix 2: Create a claim function for atomic queue processing
-- This prevents race conditions when multiple workers process the queue concurrently
CREATE OR REPLACE FUNCTION public.claim_notification_queue(batch_size int DEFAULT 50)
RETURNS SETOF notification_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE notification_queue
  SET status = 'processing'
  WHERE id IN (
    SELECT id FROM notification_queue
    WHERE status = 'pending'
       OR (status = 'retrying' AND next_retry_at <= now())
    ORDER BY created_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;