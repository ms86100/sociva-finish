
-- ============================================================
-- GAP 1: Harden nullable boolean flags to NOT NULL
-- ============================================================

-- First, backfill any NULLs to their intended defaults
UPDATE category_config SET supports_cart = false WHERE supports_cart IS NULL;
UPDATE category_config SET requires_time_slot = false WHERE requires_time_slot IS NULL;
UPDATE category_config SET enquiry_only = false WHERE enquiry_only IS NULL;
UPDATE category_config SET is_negotiable = false WHERE is_negotiable IS NULL;
UPDATE category_config SET has_duration = false WHERE has_duration IS NULL;
UPDATE category_config SET is_active = true WHERE is_active IS NULL;
UPDATE category_config SET requires_price = false WHERE requires_price IS NULL;
UPDATE category_config SET requires_availability = false WHERE requires_availability IS NULL;
UPDATE category_config SET has_quantity = true WHERE has_quantity IS NULL;
UPDATE category_config SET has_date_range = false WHERE has_date_range IS NULL;
UPDATE category_config SET requires_delivery = false WHERE requires_delivery IS NULL;
UPDATE category_config SET requires_preparation = false WHERE requires_preparation IS NULL;
UPDATE category_config SET is_physical_product = false WHERE is_physical_product IS NULL;
UPDATE category_config SET show_veg_toggle = false WHERE show_veg_toggle IS NULL;
UPDATE category_config SET show_duration_field = false WHERE show_duration_field IS NULL;

-- Now set NOT NULL constraints
ALTER TABLE category_config ALTER COLUMN supports_cart SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN supports_cart SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN requires_time_slot SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN requires_time_slot SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN enquiry_only SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN enquiry_only SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN is_negotiable SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN is_negotiable SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN has_duration SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN has_duration SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN is_active SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE category_config ALTER COLUMN requires_price SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN requires_price SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN requires_availability SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN requires_availability SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN has_quantity SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN has_quantity SET DEFAULT true;
ALTER TABLE category_config ALTER COLUMN has_date_range SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN has_date_range SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN requires_delivery SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN requires_delivery SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN requires_preparation SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN requires_preparation SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN is_physical_product SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN is_physical_product SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN show_veg_toggle SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN show_veg_toggle SET DEFAULT false;
ALTER TABLE category_config ALTER COLUMN show_duration_field SET NOT NULL;
ALTER TABLE category_config ALTER COLUMN show_duration_field SET DEFAULT false;

-- ============================================================
-- GAP 2: Retroactive enforcement when category rules change
-- Strategy: BLOCK the category update if existing products violate new rules.
-- Justification: Silent data mutation (auto-deactivating products) is dangerous
-- for sellers. Blocking forces admin to consciously handle affected products first.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_category_rule_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invalid_price_count integer;
  _invalid_cart_count integer;
BEGIN
  -- Check 1: If requires_price changed to true, ensure no products have NULL/0 price
  IF (OLD.requires_price IS DISTINCT FROM NEW.requires_price) AND NEW.requires_price = true THEN
    SELECT COUNT(*) INTO _invalid_price_count
    FROM products
    WHERE category::text = NEW.category
      AND (price IS NULL OR price <= 0);

    IF _invalid_price_count > 0 THEN
      RAISE EXCEPTION 'Cannot set requires_price=true for category "%": % existing product(s) have no price. Update or deactivate them first.',
        NEW.category, _invalid_price_count;
    END IF;
  END IF;

  -- Check 2: If transaction_type changed away from cart_purchase, ensure no cart items exist
  IF (OLD.transaction_type IS DISTINCT FROM NEW.transaction_type) THEN
    -- If new type does not support cart, verify no active cart items reference products in this category
    IF NEW.supports_cart = false THEN
      SELECT COUNT(*) INTO _invalid_cart_count
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE p.category::text = NEW.category;

      IF _invalid_cart_count > 0 THEN
        RAISE EXCEPTION 'Cannot change transaction_type to "%" for category "%": % cart item(s) still reference products in this category. Clear them first.',
          NEW.transaction_type, NEW.category, _invalid_cart_count;
      END IF;
    END IF;
  END IF;

  -- Check 3: If supports_cart changed to false, verify no cart items exist
  IF (OLD.supports_cart IS DISTINCT FROM NEW.supports_cart) AND NEW.supports_cart = false THEN
    SELECT COUNT(*) INTO _invalid_cart_count
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    WHERE p.category::text = NEW.category;

    IF _invalid_cart_count > 0 THEN
      RAISE EXCEPTION 'Cannot disable cart for category "%": % cart item(s) still exist. Clear them first.',
        NEW.category, _invalid_cart_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_validate_category_rule_change
  BEFORE UPDATE ON category_config
  FOR EACH ROW
  EXECUTE FUNCTION validate_category_rule_change();

-- ============================================================
-- GAP 3: Contact-only enforcement at DB level
-- Already partially covered by validate_cart_item_category trigger.
-- Add explicit product-level enforcement: contact_only products
-- must not have price if requires_price is false.
-- ============================================================

-- Update existing product price trigger to also enforce contact_only logic
CREATE OR REPLACE FUNCTION public.validate_product_price_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _requires_price boolean;
  _transaction_type text;
BEGIN
  SELECT cc.requires_price, cc.transaction_type
  INTO _requires_price, _transaction_type
  FROM category_config cc WHERE cc.category = NEW.category::text;

  -- Enforce: price required when category demands it
  IF _requires_price IS TRUE AND (NEW.price IS NULL OR NEW.price <= 0) THEN
    RAISE EXCEPTION 'Price is required for category "%"', NEW.category;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- GAP 4: Transaction type change protection
-- Already handled by trg_validate_category_rule_change above.
-- That trigger blocks transaction_type changes when:
--   - Cart items exist for the category (if new type drops cart support)
--   - Products violate new price requirements
-- ============================================================
