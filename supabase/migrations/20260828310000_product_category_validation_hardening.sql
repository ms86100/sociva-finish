-- Harden category validation: allow active categories when primary_group is unset,
-- and auto-append valid primary_group categories to seller_profiles.categories.

CREATE OR REPLACE FUNCTION public.validate_product_seller_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _seller_categories text[];
  _primary_group text;
BEGIN
  SELECT categories, primary_group
  INTO _seller_categories, _primary_group
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF _seller_categories IS NOT NULL
     AND array_length(_seller_categories, 1) IS NOT NULL
     AND NEW.category = ANY(_seller_categories) THEN
    RETURN NEW;
  END IF;

  IF _primary_group IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.category_config cc
    WHERE cc.category = NEW.category
      AND cc.parent_group = _primary_group
      AND COALESCE(cc.is_active, true) = true
  ) THEN
    UPDATE public.seller_profiles
    SET categories = (
      SELECT ARRAY(
        SELECT DISTINCT unnest(
          COALESCE(_seller_categories, ARRAY[]::text[]) || ARRAY[NEW.category::text]
        )
      )
    )
    WHERE id = NEW.seller_id;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.category_config cc
    WHERE cc.category = NEW.category
      AND COALESCE(cc.is_active, true) = true
  ) THEN
    RETURN NEW;
  END IF;

  IF _seller_categories IS NULL OR array_length(_seller_categories, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Product category "%" is not in seller''s allowed categories', NEW.category;
END;
$$;
