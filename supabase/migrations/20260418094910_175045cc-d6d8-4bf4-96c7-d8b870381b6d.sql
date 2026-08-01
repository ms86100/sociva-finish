-- Backfill category_status_flows for default + seller_delivery, default + delivery, default + self_pickup
-- Mirrors food_beverages + seller_delivery so workflow engine resolves identically for any group via 'default' fallback.

INSERT INTO public.category_status_flows
  (parent_group, transaction_type, status_key, sort_order, actor, is_terminal, is_success, requires_otp, otp_type, display_label, color, icon, notify_buyer, notify_seller, creates_tracking_assignment, starts_live_activity, buyer_display_label, seller_display_label, is_transit, is_deprecated)
VALUES
  -- default + seller_delivery
  ('default', 'seller_delivery', 'placed',     10, 'buyer',  false, false, false, NULL,       'Placed',     'bg-blue-100 text-blue-700',      'ShoppingCart',  false, true,  false, false, NULL, NULL, false, false),
  ('default', 'seller_delivery', 'accepted',   20, 'seller', false, false, false, NULL,       'Accepted',   'bg-green-100 text-green-700',    'ThumbsUp',      true,  false, false, false, NULL, NULL, false, false),
  ('default', 'seller_delivery', 'preparing',  30, 'seller', false, false, false, NULL,       'Preparing',  'bg-yellow-100 text-yellow-700',  'ChefHat',       true,  false, false, false, NULL, NULL, false, false),
  ('default', 'seller_delivery', 'ready',      40, 'seller', false, false, false, NULL,       'Ready',      'bg-emerald-100 text-emerald-700','Package',       true,  false, false, false, 'Ready for Delivery', 'Ready to Deliver', false, false),
  ('default', 'seller_delivery', 'picked_up',  45, 'seller', false, false, true,  'generic',  'Picked Up',  'bg-teal-100 text-teal-700',      'PackageCheck',  false, false, true,  false, NULL, NULL, false, false),
  ('default', 'seller_delivery', 'on_the_way', 50, 'seller', false, false, false, NULL,       'On the Way', 'bg-indigo-100 text-indigo-700',  'Navigation',    true,  false, false, true,  NULL, NULL, true,  false),
  ('default', 'seller_delivery', 'delivered',  70, 'seller', true,  true,  true,  'delivery', 'Delivered',  'bg-green-100 text-green-700',    'CheckCircle',   true,  false, false, false, NULL, NULL, false, false),
  ('default', 'seller_delivery', 'cancelled',  90, 'buyer',  true,  false, false, NULL,       'Cancelled',  'bg-red-100 text-red-700',        'XCircle',       true,  true,  false, false, NULL, NULL, false, false),

  -- default + delivery (platform-managed delivery partner pickup/dropoff)
  ('default', 'delivery', 'placed',     10, 'buyer',   false, false, false, NULL,       'Placed',     'bg-blue-100 text-blue-700',      'ShoppingCart',  false, true,  false, false, NULL, NULL, false, false),
  ('default', 'delivery', 'accepted',   20, 'seller',  false, false, false, NULL,       'Accepted',   'bg-green-100 text-green-700',    'ThumbsUp',      true,  false, false, false, NULL, NULL, false, false),
  ('default', 'delivery', 'preparing',  30, 'seller',  false, false, false, NULL,       'Preparing',  'bg-yellow-100 text-yellow-700',  'ChefHat',       true,  false, false, false, NULL, NULL, false, false),
  ('default', 'delivery', 'ready',      40, 'seller',  false, false, false, NULL,       'Ready',      'bg-emerald-100 text-emerald-700','Package',       true,  false, true,  false, 'Ready for Pickup', 'Ready for Pickup', false, false),
  ('default', 'delivery', 'picked_up',  45, 'delivery',false, false, true,  'generic',  'Picked Up',  'bg-teal-100 text-teal-700',      'PackageCheck',  true,  false, false, false, NULL, NULL, false, false),
  ('default', 'delivery', 'on_the_way', 50, 'delivery',false, false, false, NULL,       'On the Way', 'bg-indigo-100 text-indigo-700',  'Navigation',    true,  false, false, true,  NULL, NULL, true,  false),
  ('default', 'delivery', 'delivered',  70, 'delivery',true,  true,  true,  'delivery', 'Delivered',  'bg-green-100 text-green-700',    'CheckCircle',   true,  false, false, false, NULL, NULL, false, false),
  ('default', 'delivery', 'cancelled',  90, 'buyer',   true,  false, false, NULL,       'Cancelled',  'bg-red-100 text-red-700',        'XCircle',       true,  true,  false, false, NULL, NULL, false, false),

  -- default + self_pickup (buyer comes to seller location)
  ('default', 'self_pickup', 'placed',    10, 'buyer',  false, false, false, NULL,      'Placed',     'bg-blue-100 text-blue-700',      'ShoppingCart',  false, true,  false, false, NULL, NULL, false, false),
  ('default', 'self_pickup', 'accepted',  20, 'seller', false, false, false, NULL,      'Accepted',   'bg-green-100 text-green-700',    'ThumbsUp',      true,  false, false, false, NULL, NULL, false, false),
  ('default', 'self_pickup', 'preparing', 30, 'seller', false, false, false, NULL,      'Preparing',  'bg-yellow-100 text-yellow-700',  'ChefHat',       true,  false, false, false, NULL, NULL, false, false),
  ('default', 'self_pickup', 'ready',     40, 'seller', false, false, false, NULL,      'Ready for Pickup', 'bg-emerald-100 text-emerald-700','Package', true,  false, false, false, 'Ready for Pickup', 'Ready for Pickup', false, false),
  ('default', 'self_pickup', 'picked_up', 70, 'seller', true,  true,  true,  'generic', 'Collected',  'bg-green-100 text-green-700',    'CheckCircle',   true,  false, false, false, 'Collected', 'Handed Over', false, false),
  ('default', 'self_pickup', 'cancelled', 90, 'buyer',  true,  false, false, NULL,      'Cancelled',  'bg-red-100 text-red-700',        'XCircle',       true,  true,  false, false, NULL, NULL, false, false)
ON CONFLICT DO NOTHING;

-- Backfill matching transitions if missing for default + delivery / default + self_pickup
-- (default + seller_delivery transitions already exist per investigation).
INSERT INTO public.category_status_transitions
  (parent_group, transaction_type, from_status, to_status, allowed_actor, allowed_roles, is_side_action, auto_transition)
VALUES
  -- default + delivery
  ('default', 'delivery', 'placed',     'accepted',   'seller',  ARRAY['seller'],  false, false),
  ('default', 'delivery', 'placed',     'cancelled',  'seller',  ARRAY['seller'],  false, false),
  ('default', 'delivery', 'placed',     'cancelled',  'buyer',   ARRAY['buyer'],   false, false),
  ('default', 'delivery', 'accepted',   'preparing',  'seller',  ARRAY['seller'],  false, false),
  ('default', 'delivery', 'accepted',   'cancelled',  'seller',  ARRAY['seller'],  false, false),
  ('default', 'delivery', 'preparing',  'ready',      'seller',  ARRAY['seller'],  false, false),
  ('default', 'delivery', 'ready',      'picked_up',  'delivery',ARRAY['delivery','seller'], false, false),
  ('default', 'delivery', 'picked_up',  'on_the_way', 'delivery',ARRAY['delivery','seller'], false, false),
  ('default', 'delivery', 'on_the_way', 'delivered',  'delivery',ARRAY['delivery','seller'], false, false),

  -- default + self_pickup
  ('default', 'self_pickup', 'placed',    'accepted',   'seller', ARRAY['seller'], false, false),
  ('default', 'self_pickup', 'placed',    'cancelled',  'seller', ARRAY['seller'], false, false),
  ('default', 'self_pickup', 'placed',    'cancelled',  'buyer',  ARRAY['buyer'],  false, false),
  ('default', 'self_pickup', 'accepted',  'preparing',  'seller', ARRAY['seller'], false, false),
  ('default', 'self_pickup', 'accepted',  'cancelled',  'seller', ARRAY['seller'], false, false),
  ('default', 'self_pickup', 'preparing', 'ready',      'seller', ARRAY['seller'], false, false),
  ('default', 'self_pickup', 'ready',     'picked_up',  'seller', ARRAY['seller'], false, false)
ON CONFLICT DO NOTHING;