
CREATE OR REPLACE FUNCTION public.check_seller_license()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _primary_group text;
  _group_id uuid;
  _license_mandatory boolean;
  _has_license boolean;
BEGIN
  -- Allow draft products without license check
  IF NEW.approval_status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Allow edits to previously approved products (license was already validated)
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Get seller's primary group
  SELECT primary_group INTO _primary_group
  FROM public.seller_profiles WHERE id = NEW.seller_id;

  IF _primary_group IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get group config
  SELECT id, license_mandatory INTO _group_id, _license_mandatory
  FROM public.parent_groups
  WHERE slug = _primary_group AND requires_license = true;

  IF _group_id IS NULL OR _license_mandatory IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Check for approved license
  SELECT EXISTS (
    SELECT 1 FROM public.seller_licenses
    WHERE seller_id = NEW.seller_id
      AND group_id = _group_id
      AND status = 'approved'
  ) INTO _has_license;

  IF NOT _has_license THEN
    RAISE EXCEPTION 'Cannot create or update products: mandatory license for this category has not been approved. Please upload and get your % approved first.', 
      (SELECT license_type_name FROM public.parent_groups WHERE id = _group_id);
  END IF;

  RETURN NEW;
END;
$function$;
