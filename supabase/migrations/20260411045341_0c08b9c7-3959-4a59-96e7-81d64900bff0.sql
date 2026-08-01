
-- 1. Remove at_gate and buyer_received from seller_delivery flows
DELETE FROM category_status_flows
WHERE transaction_type = 'seller_delivery'
  AND status_key IN ('at_gate', 'buyer_received');

-- 2. Add picked_up step with creates_tracking_assignment = true
INSERT INTO category_status_flows (
  parent_group, transaction_type, status_key, sort_order, actor,
  is_transit, creates_tracking_assignment, is_terminal, is_success,
  display_name, otp_type, requires_otp
)
SELECT DISTINCT
  parent_group, 'seller_delivery', 'picked_up', 45, 'seller',
  true, true, false, false,
  'Picked Up', NULL, false
FROM category_status_flows
WHERE transaction_type = 'seller_delivery'
  AND status_key = 'ready'
ON CONFLICT DO NOTHING;

-- 3. Fix on_the_way: no OTP, no tracking assignment creation
UPDATE category_status_flows
SET creates_tracking_assignment = false,
    otp_type = NULL,
    requires_otp = false
WHERE transaction_type = 'seller_delivery'
  AND status_key = 'on_the_way';

-- 4. Fix delivered: seller marks it, no OTP
UPDATE category_status_flows
SET actor = 'seller',
    otp_type = NULL,
    requires_otp = false
WHERE transaction_type = 'seller_delivery'
  AND status_key = 'delivered';

-- 5. Clear all seller_delivery transitions
DELETE FROM category_status_transitions
WHERE transaction_type = 'seller_delivery';

-- 6. Insert canonical transitions
INSERT INTO category_status_transitions
  (parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action)
VALUES
  ('food_beverages','seller_delivery','placed','accepted','seller',false),
  ('food_beverages','seller_delivery','placed','cancelled','buyer',true),
  ('food_beverages','seller_delivery','accepted','preparing','seller',false),
  ('food_beverages','seller_delivery','accepted','cancelled','seller',true),
  ('food_beverages','seller_delivery','preparing','ready','seller',false),
  ('food_beverages','seller_delivery','preparing','cancelled','seller',true),
  ('food_beverages','seller_delivery','ready','picked_up','seller',false),
  ('food_beverages','seller_delivery','picked_up','on_the_way','seller',false),
  ('food_beverages','seller_delivery','on_the_way','delivered','seller',false),
  ('food_beverages','seller_delivery','delivered','completed','system',false),
  ('food_beverages','seller_delivery','delivered','payment_pending','system',false),
  ('food_beverages','seller_delivery','payment_pending','completed','buyer',false),
  ('default','seller_delivery','placed','accepted','seller',false),
  ('default','seller_delivery','placed','cancelled','buyer',true),
  ('default','seller_delivery','accepted','preparing','seller',false),
  ('default','seller_delivery','accepted','cancelled','seller',true),
  ('default','seller_delivery','preparing','ready','seller',false),
  ('default','seller_delivery','preparing','cancelled','seller',true),
  ('default','seller_delivery','ready','picked_up','seller',false),
  ('default','seller_delivery','picked_up','on_the_way','seller',false),
  ('default','seller_delivery','on_the_way','delivered','seller',false),
  ('default','seller_delivery','delivered','completed','system',false),
  ('default','seller_delivery','delivered','payment_pending','system',false),
  ('default','seller_delivery','payment_pending','completed','buyer',false);
