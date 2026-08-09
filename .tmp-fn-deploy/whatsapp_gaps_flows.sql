-- 2) Enable buyer notify for in_progress (service started)
-- ---------------------------------------------------------------------------
UPDATE public.category_status_flows
SET
  notify_buyer = true,
  notification_title = COALESCE(NULLIF(notification_title, ''), '🔧 Service Started'),
  notification_body = COALESCE(
    NULLIF(notification_body, ''),
    '{seller_name} has started your service.'
  )
WHERE status_key = 'in_progress'
  AND notify_buyer = false;

-- ---------------------------------------------------------------------------
-- 3) Seed missing "arrived" buyer notification flows (clone from on_the_way pairs)
-- ---------------------------------------------------------------------------
INSERT INTO public.category_status_flows (
  parent_group, transaction_type, status_key, sort_order, actor,
  notify_buyer, notify_seller,
  notification_title, notification_body,
  display_name, display_label, color, icon, statuses
)
SELECT
  f.parent_group,
  f.transaction_type,
  'arrived',
  COALESCE(f.sort_order, 60) + 5,
  COALESCE(f.actor, 'seller'),
  true,
  false,
  '🏠 Service Provider Arrived',
  '{seller_name} has arrived.',
  'Arrived',
  'Arrived',
  COALESCE(NULLIF(f.color, ''), 'bg-teal-100 text-teal-800'),
  COALESCE(NULLIF(f.icon, ''), 'MapPin'),
  ARRAY['arrived']::text[]
FROM public.category_status_flows f
WHERE f.status_key = 'on_the_way'
  AND NOT EXISTS (
    SELECT 1 FROM public.category_status_flows x
    WHERE x.parent_group = f.parent_group
      AND x.transaction_type = f.transaction_type
      AND x.status_key = 'arrived'
  );

-- ---------------------------------------------------------------------------
