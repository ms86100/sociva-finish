
-- 1. Drop the redundant INSERT trigger that causes duplicate 'placed' notifications
DROP TRIGGER IF EXISTS trg_enqueue_new_order_notification ON public.orders;

-- 2. Drop the orphaned function
DROP FUNCTION IF EXISTS public.fn_enqueue_new_order_notification();

-- 3. Clean up existing duplicate notification_queue entries (keep oldest per order+status)
DELETE FROM public.notification_queue nq
WHERE nq.id NOT IN (
  SELECT DISTINCT ON (reference_path, payload->>'status') id
  FROM public.notification_queue
  WHERE reference_path IS NOT NULL
    AND reference_path LIKE '/orders/%'
  ORDER BY reference_path, payload->>'status', created_at ASC
)
AND nq.reference_path IS NOT NULL
AND nq.reference_path LIKE '/orders/%';
