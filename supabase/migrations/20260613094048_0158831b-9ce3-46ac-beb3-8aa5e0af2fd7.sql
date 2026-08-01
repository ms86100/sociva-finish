CREATE OR REPLACE FUNCTION public.check_seller_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _category_record record;
  _parent_group_record record;
  _has_valid_license boolean;
BEGIN
  -- Sellers must be able to build onboarding drafts and submit them for admin review
  -- while the required license is still pending review. Only live/approved items
  -- require an already approved license.
  IF COALESCE(NEW.approval_status, 'draft') IN ('draft', 'pending') THEN
    RETURN NEW;
  END IF;

  SELECT cc.*
  INTO _category_record
  FROM public.category_config cc
  WHERE cc.category = NEW.category
  LIMIT 1;

  IF _category_record IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT pg.*
  INTO _parent_group_record
  FROM public.parent_groups pg
  WHERE pg.slug = _category_record.parent_group
  LIMIT 1;

  IF _parent_group_record IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(_category_record.requires_license, false) IS NOT TRUE
     AND COALESCE(_parent_group_record.requires_license, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF COALESCE(_category_record.license_mandatory, _parent_group_record.license_mandatory, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.seller_licenses sl
    WHERE sl.seller_id = NEW.seller_id
      AND sl.status = 'approved'
      AND (sl.expires_at IS NULL OR sl.expires_at > now())
      AND (
        sl.group_id = _parent_group_record.id
        OR sl.category_config_id = _category_record.id
        OR sl.license_type = _parent_group_record.slug
        OR sl.license_type = COALESCE(_category_record.license_type_name, _parent_group_record.license_type_name)
      )
  ) INTO _has_valid_license;

  IF NOT _has_valid_license THEN
    RAISE EXCEPTION 'Seller does not have a valid % license',
      COALESCE(_category_record.license_type_name, _parent_group_record.license_type_name, 'required');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS check_seller_license_trigger ON public.products;

DROP TRIGGER IF EXISTS check_seller_license_before_product ON public.products;
CREATE TRIGGER check_seller_license_before_product
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.check_seller_license();