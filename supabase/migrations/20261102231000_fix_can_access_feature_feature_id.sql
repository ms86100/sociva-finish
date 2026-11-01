-- society_feature_overrides stores feature_id, not feature_key.
-- The previous can_access_feature body queried feature_key and failed every
-- Cleaner City write (profile save, publish, OTP) with:
--   column "feature_key" does not exist
-- Delegate to is_feature_enabled_for_society, which already joins on feature_id.

CREATE OR REPLACE FUNCTION public.can_access_feature(_society_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_feature_enabled_for_society(_society_id, _feature_key);
$$;

REVOKE ALL ON FUNCTION public.can_access_feature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_feature(uuid, text) TO authenticated, service_role;
