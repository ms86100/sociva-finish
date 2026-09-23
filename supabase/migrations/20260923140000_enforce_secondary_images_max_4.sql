-- Enforce max 4 secondary images (primary lives in image_url → 5 total).
-- Existing single-image products (null/empty secondary_images) remain valid.

CREATE OR REPLACE FUNCTION public.enforce_product_secondary_images_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.secondary_images IS NOT NULL
     AND coalesce(array_length(NEW.secondary_images, 1), 0) > 4 THEN
    RAISE EXCEPTION 'secondary_images may contain at most 4 URLs (5 images total including image_url)';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_product_secondary_images_limit ON public.products;
CREATE TRIGGER trg_enforce_product_secondary_images_limit
  BEFORE INSERT OR UPDATE OF secondary_images ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_secondary_images_limit();
