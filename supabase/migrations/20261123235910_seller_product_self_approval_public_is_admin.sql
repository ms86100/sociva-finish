-- Staging only. Production-portable form of seller/product self-approval lock.
-- Uses public.is_admin(auth.uid()) so a production copy without sociva_private still works.
-- Does not change marketplace RPCs or membership.

CREATE OR REPLACE FUNCTION public.sociva_block_self_privilege_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'seller_profiles' THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.verification_status, 'draft') NOT IN ('draft', 'pending') THEN
        RAISE EXCEPTION 'not authorized to set seller verification_status' USING ERRCODE = '42501';
      END IF;
      NEW.is_featured := false;
      NEW.rating := COALESCE(NEW.rating, 0);
    ELSIF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      IF NEW.verification_status NOT IN ('draft', 'pending', 'rejected') THEN
        RAISE EXCEPTION 'not authorized to set seller verification_status' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.is_featured IS DISTINCT FROM OLD.is_featured THEN
        RAISE EXCEPTION 'not authorized to set is_featured' USING ERRCODE = '42501';
      END IF;
      IF NEW.rating IS DISTINCT FROM OLD.rating THEN
        RAISE EXCEPTION 'not authorized to set rating' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.approval_status, 'draft') NOT IN ('draft', 'pending') THEN
        RAISE EXCEPTION 'not authorized to set product approval_status' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      IF NEW.approval_status NOT IN ('draft', 'pending', 'rejected') THEN
        RAISE EXCEPTION 'not authorized to set product approval_status' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sociva_block_self_privilege_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sociva_block_self_privilege_status() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_sociva_block_self_privilege_seller ON public.seller_profiles;
CREATE TRIGGER trg_sociva_block_self_privilege_seller
BEFORE INSERT OR UPDATE ON public.seller_profiles
FOR EACH ROW
EXECUTE FUNCTION public.sociva_block_self_privilege_status();

DROP TRIGGER IF EXISTS trg_sociva_block_self_privilege_product ON public.products;
CREATE TRIGGER trg_sociva_block_self_privilege_product
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sociva_block_self_privilege_status();
