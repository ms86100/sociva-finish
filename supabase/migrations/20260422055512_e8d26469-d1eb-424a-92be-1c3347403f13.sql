-- Backfill review_prompt rows with NULL reference_path
UPDATE public.user_notifications
SET reference_path = '/orders/' || COALESCE(payload->>'order_id', payload->>'orderId', payload->>'entity_id')
WHERE type = 'review_prompt'
  AND reference_path IS NULL
  AND COALESCE(payload->>'order_id', payload->>'orderId', payload->>'entity_id') IS NOT NULL;

-- Fix review_received pointing to dead /seller/dashboard
UPDATE public.user_notifications
SET reference_path = CASE
  WHEN COALESCE(payload->>'order_id', payload->>'orderId', payload->>'entity_id') IS NOT NULL
    THEN '/orders/' || COALESCE(payload->>'order_id', payload->>'orderId', payload->>'entity_id')
  ELSE '/seller'
END
WHERE type IN ('review_received', 'review')
  AND reference_path IN ('/seller/dashboard', '/seller/reviews');

-- Fix support_ticket pointing to dead /support/<id>
UPDATE public.user_notifications
SET reference_path = '/orders/' || COALESCE(payload->>'order_id', payload->>'orderId')
WHERE type = 'support_ticket'
  AND reference_path LIKE '/support/%'
  AND COALESCE(payload->>'order_id', payload->>'orderId') IS NOT NULL;

-- Fix any settlement rows pointing to dead /seller/settlements
UPDATE public.user_notifications
SET reference_path = '/seller/earnings'
WHERE type = 'settlement'
  AND reference_path = '/seller/settlements';