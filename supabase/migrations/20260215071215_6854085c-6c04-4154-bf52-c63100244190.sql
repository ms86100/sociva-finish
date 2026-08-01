
-- ==============================================
-- FIX 2: Product Approval Workflow (column + backfill FIRST, before any new triggers)
-- ==============================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft';

-- Backfill: all existing products become approved (no new triggers exist yet)
UPDATE public.products SET approval_status = 'approved';

-- ==============================================
-- FIX 1: Backend Category Validation Trigger
-- Skips validation for existing rows; only fires on NEW inserts/updates going forward
-- ==============================================
CREATE OR REPLACE FUNCTION public.validate_product_category()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _cat record;
BEGIN
  SELECT cc.is_active, pg.is_active AS group_active
  INTO _cat
  FROM category_config cc
  JOIN parent_groups pg ON pg.slug = cc.parent_group
  WHERE cc.category = NEW.category::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid category: %. Category does not exist.', NEW.category;
  END IF;
  IF NOT _cat.is_active THEN
    RAISE EXCEPTION 'Category "%" is currently disabled.', NEW.category;
  END IF;
  IF NOT _cat.group_active THEN
    RAISE EXCEPTION 'Parent group for category "%" is currently disabled.', NEW.category;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_product_category
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_category();

-- Approval status validation trigger
CREATE OR REPLACE FUNCTION public.validate_product_approval_status()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.approval_status NOT IN ('draft', 'pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid approval_status: %', NEW.approval_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_product_approval_status
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_approval_status();

-- Update SELECT RLS: buyers only see approved products
DROP POLICY IF EXISTS "Anyone can view available products from approved sellers" ON products;

CREATE POLICY "Anyone can view available products from approved sellers"
ON products FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM seller_profiles
    WHERE seller_profiles.id = products.seller_id
      AND seller_profiles.user_id = auth.uid()
  )
  OR is_admin(auth.uid())
  OR (
    products.approval_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM seller_profiles
      WHERE seller_profiles.id = products.seller_id
        AND seller_profiles.verification_status = 'approved'
        AND seller_profiles.society_id = get_user_society_id(auth.uid())
    )
  )
  OR (
    products.approval_status = 'approved'
    AND EXISTS (
      SELECT 1 FROM seller_profiles
      WHERE seller_profiles.id = products.seller_id
        AND seller_profiles.verification_status = 'approved'
        AND seller_profiles.sell_beyond_community = true
    )
  )
);

-- ==============================================
-- FIX 6: Server-Side Hint Enforcement (Data Normalization)
-- ==============================================
CREATE OR REPLACE FUNCTION public.normalize_product_hints()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _show_veg boolean;
  _show_duration boolean;
BEGIN
  SELECT show_veg_toggle, show_duration_field
  INTO _show_veg, _show_duration
  FROM category_config
  WHERE category = NEW.category::text;

  IF _show_veg IS NOT TRUE THEN
    NEW.is_veg := true;
  END IF;

  IF _show_duration IS NOT TRUE THEN
    NEW.prep_time_minutes := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_normalize_product_hints
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.normalize_product_hints();
