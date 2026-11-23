-- SSV-001 (staging): stop authenticated JWTs from writing profiles.society_id.
-- The previous trigger was SECURITY DEFINER, so current_user was the owner and
-- the IF current_user IN ('authenticated','anon') lock never ran.
-- Defense in depth: auth.role() lock + column UPDATE grant without society_id.
-- DEFINER RPCs (request_society_membership / decide_society_membership) still
-- update society_id as the table owner after set_config('app.allow_society_change').

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_jwt_role text;
BEGIN
  v_jwt_role := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Enforce for PostgREST JWT sessions. Skip bare superuser/ops (no JWT).
  IF v_jwt_role IN ('authenticated', 'anon') THEN
    IF NEW.society_id IS DISTINCT FROM OLD.society_id THEN
      IF current_setting('app.allow_society_change', true) IS DISTINCT FROM 'true'
         AND NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'profiles.society_id is locked - use request_society_membership'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
       AND NOT public.is_admin(auth.uid())
       AND current_setting('app.allow_verification_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'profiles.verification_status cannot be self-updated'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_profile_privileged_columns() IS
  'Fail-closed: JWT authenticated/anon cannot change society_id or verification_status unless admin or audited RPC sets app.allow_*. Uses auth.role() because this function is SECURITY DEFINER.';

DROP TRIGGER IF EXISTS trg_guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER trg_guard_profile_privileged_columns
  BEFORE UPDATE OF society_id, verification_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileged_columns();

REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

-- Keep verification_status updatable for platform-admin PostgREST (trigger still
-- blocks non-admins). Do not grant society_id.
GRANT UPDATE (
  phone,
  name,
  flat_number,
  block,
  avatar_url,
  phase,
  email,
  browse_beyond_community,
  search_radius_km,
  latitude,
  longitude,
  has_seen_onboarding,
  tower_id,
  unit_id,
  updated_at,
  verification_status,
  phone_verified
) ON public.profiles TO authenticated;
