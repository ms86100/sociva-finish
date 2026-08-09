-- Fix: service_booking seller status loop (confirmed ↔ scheduled forever)
--
-- Root cause: category_status_transitions had 'scheduled → confirmed' as a
-- primary CTA (is_side_action=false) but was missing 'scheduled → in_progress'.
-- This caused sellers to bounce between confirmed and scheduled with no way
-- to reach in_progress → completed.

-- 1. Add the missing scheduled → in_progress for all service_booking parent groups
INSERT INTO category_status_transitions
  (parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action)
SELECT DISTINCT
  cst.parent_group,
  'service_booking',
  'scheduled',
  'in_progress',
  'seller',
  false
FROM category_status_transitions cst
WHERE cst.transaction_type = 'service_booking'
  AND NOT EXISTS (
    SELECT 1 FROM category_status_transitions x
    WHERE x.transaction_type = 'service_booking'
      AND x.parent_group = cst.parent_group
      AND x.from_status = 'scheduled'
      AND x.to_status = 'in_progress'
      AND x.allowed_actor = 'seller'
  );

-- 2. Demote scheduled → confirmed to side action (keep it for "undo scheduled", not primary CTA)
UPDATE category_status_transitions
SET is_side_action = true
WHERE transaction_type = 'service_booking'
  AND from_status = 'scheduled'
  AND to_status = 'confirmed'
  AND allowed_actor = 'seller'
  AND is_side_action = false;

-- 3. Add confirmed → in_progress as a side action (skip scheduled when service starts immediately)
INSERT INTO category_status_transitions
  (parent_group, transaction_type, from_status, to_status, allowed_actor, is_side_action)
SELECT DISTINCT
  cst.parent_group,
  'service_booking',
  'confirmed',
  'in_progress',
  'seller',
  true
FROM category_status_transitions cst
WHERE cst.transaction_type = 'service_booking'
  AND NOT EXISTS (
    SELECT 1 FROM category_status_transitions x
    WHERE x.transaction_type = 'service_booking'
      AND x.parent_group = cst.parent_group
      AND x.from_status = 'confirmed'
      AND x.to_status = 'in_progress'
      AND x.allowed_actor = 'seller'
  );
