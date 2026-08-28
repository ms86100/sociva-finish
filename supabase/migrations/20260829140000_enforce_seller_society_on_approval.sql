-- Approved seller stores must belong to a society (prevents null society_id after admin approve).

CREATE OR REPLACE FUNCTION public.enforce_seller_society_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_society uuid;
BEGIN
  IF NEW.verification_status = 'approved' AND NEW.society_id IS NULL THEN
    SELECT p.society_id
    INTO v_profile_society
    FROM public.profiles p
    WHERE p.id = NEW.user_id;

    IF v_profile_society IS NOT NULL THEN
      NEW.society_id := v_profile_society;
    ELSE
      RAISE EXCEPTION
        'SELLER_SOCIETY_REQUIRED: Cannot approve store without a society. Link the seller account to a society first.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_seller_society_on_approval ON public.seller_profiles;
CREATE TRIGGER trg_enforce_seller_society_on_approval
  BEFORE INSERT OR UPDATE OF verification_status, society_id ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_seller_society_on_approval();
