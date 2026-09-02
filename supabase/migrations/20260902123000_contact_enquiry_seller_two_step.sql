-- Contact Enquiry: seller can close in two steps (accept → delivered).
-- Additive only. Cart, booking, and request_service flows are unchanged.
--
-- Today (bug):
--   Buyer contact creates order status=enquired, transaction_type=contact_enquiry.
--   Health (and several other groups) had cancel-only transitions and no seller
--   forward edges, so the seller CTA never resolved. Default contact_enquiry also
--   lacked enquired→quoted for seller, and completed was buyer-only.
--   The UI progress rail always showed cart pickup stages
--   (Confirmed / Prep / Ready / Picked up).
--
-- After:
--   enquired → quoted (seller Accept enquiry)
--   quoted   → completed (seller Mark delivered)
--   cancel remains available as a side action.

-- Align listing_type map with resolveTransactionType / client fallback.
UPDATE public.listing_type_workflow_map
SET workflow_key = 'contact_enquiry'
WHERE listing_type = 'contact_only'
  AND workflow_key IS DISTINCT FROM 'contact_enquiry';

-- Default flow copy: Accept / Delivered, seller can complete.
UPDATE public.category_status_flows
SET
  display_label = 'Enquiry',
  seller_display_label = 'New enquiry',
  buyer_display_label = 'Enquiry sent',
  seller_hint = 'New contact enquiry — accept it, then mark delivered when done.',
  buyer_hint = 'Your enquiry has been sent. The seller will respond soon.',
  seller_notification_title = 'New contact enquiry',
  seller_notification_body = '{buyer_name} contacted you. Tap to accept.'
WHERE parent_group = 'default'
  AND transaction_type = 'contact_enquiry'
  AND status_key = 'enquired';

UPDATE public.category_status_flows
SET
  display_label = 'Accepted',
  seller_display_label = 'Accepted',
  buyer_display_label = 'Seller accepted',
  seller_hint = 'Enquiry accepted. Mark delivered when the request is fulfilled.',
  buyer_hint = 'The seller accepted your enquiry.',
  notification_title = 'Enquiry accepted',
  notification_body = '{seller_name} accepted your enquiry.'
WHERE parent_group = 'default'
  AND transaction_type = 'contact_enquiry'
  AND status_key = 'quoted';

UPDATE public.category_status_flows
SET
  actor = 'seller,buyer',
  display_label = 'Delivered',
  seller_display_label = 'Delivered',
  buyer_display_label = 'Delivered',
  seller_hint = 'This enquiry is complete.',
  buyer_hint = 'Enquiry delivered / closed.'
WHERE parent_group = 'default'
  AND transaction_type = 'contact_enquiry'
  AND status_key = 'completed';

-- Flow rows for groups that currently fall back to default (including health).
INSERT INTO public.category_status_flows (
  parent_group, transaction_type, status_key, sort_order, actor,
  is_terminal, is_success, is_transit, requires_otp, otp_type,
  display_label, seller_display_label, buyer_display_label,
  seller_hint, buyer_hint, notify_buyer, notify_seller,
  seller_notification_title, seller_notification_body,
  notification_title, notification_body, color, icon, display_name, statuses
)
SELECT
  g.slug,
  d.transaction_type,
  d.status_key,
  d.sort_order,
  d.actor,
  d.is_terminal,
  d.is_success,
  d.is_transit,
  d.requires_otp,
  d.otp_type,
  d.display_label,
  d.seller_display_label,
  d.buyer_display_label,
  d.seller_hint,
  d.buyer_hint,
  d.notify_buyer,
  d.notify_seller,
  d.seller_notification_title,
  d.seller_notification_body,
  d.notification_title,
  d.notification_body,
  d.color,
  d.icon,
  d.display_name,
  d.statuses
FROM public.parent_groups g
CROSS JOIN public.category_status_flows d
WHERE g.is_active = true
  AND d.parent_group = 'default'
  AND d.transaction_type = 'contact_enquiry'
  AND NOT EXISTS (
    SELECT 1
    FROM public.category_status_flows existing
    WHERE existing.parent_group = g.slug
      AND existing.transaction_type = 'contact_enquiry'
      AND existing.status_key = d.status_key
  );

-- Seller two-step + decline for every contact_enquiry group (including default).
WITH groups AS (
  SELECT 'default'::text AS slug
  UNION
  SELECT slug FROM public.parent_groups WHERE is_active = true
  UNION
  SELECT DISTINCT parent_group
  FROM public.category_status_transitions
  WHERE transaction_type = 'contact_enquiry'
),
needed AS (
  SELECT slug AS parent_group, x.from_status, x.to_status, x.allowed_actor, x.is_side_action, x.display_label
  FROM groups
  CROSS JOIN (
    VALUES
      ('enquired', 'quoted',    'seller', false, 'Accept enquiry'),
      ('quoted',   'completed', 'seller', false, 'Mark delivered'),
      ('enquired', 'cancelled', 'seller', true,  'Decline enquiry'),
      ('quoted',   'cancelled', 'seller', true,  'Cancel enquiry')
  ) AS x(from_status, to_status, allowed_actor, is_side_action, display_label)
)
INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status,
  allowed_actor, allowed_roles, is_side_action, display_label
)
SELECT
  n.parent_group,
  'contact_enquiry',
  n.from_status,
  n.to_status,
  n.allowed_actor,
  ARRAY['seller']::text[],
  n.is_side_action,
  n.display_label
FROM needed n
WHERE NOT EXISTS (
  SELECT 1
  FROM public.category_status_transitions t
  WHERE t.parent_group = n.parent_group
    AND t.transaction_type = 'contact_enquiry'
    AND t.from_status = n.from_status
    AND t.to_status = n.to_status
    AND t.allowed_actor = n.allowed_actor
);
