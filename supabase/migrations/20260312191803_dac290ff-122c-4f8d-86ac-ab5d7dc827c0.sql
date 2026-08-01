
CREATE OR REPLACE FUNCTION public.validate_seller_location_on_approval()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _society_lat double precision;
  _society_lng double precision;
BEGIN
  IF NEW.verification_status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF OLD IS NOT NULL AND OLD.verification_status IS NOT DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;

  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.society_id IS NOT NULL THEN
    SELECT s.latitude::double precision, s.longitude::double precision
      INTO _society_lat, _society_lng
    FROM public.societies s
    WHERE s.id = NEW.society_id;

    IF _society_lat IS NOT NULL AND _society_lng IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Cannot approve seller without location coordinates. Set store location or ensure society has coordinates.';
END;
$function$;

CREATE TRIGGER trg_validate_seller_location_on_approval
  BEFORE UPDATE ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_seller_location_on_approval();
