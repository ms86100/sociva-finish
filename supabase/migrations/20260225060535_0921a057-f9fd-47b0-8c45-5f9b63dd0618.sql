-- B3: Add is_security_officer and is_worker to get_user_auth_context RPC
-- This eliminates 2 separate queries per page load in BottomNav
CREATE OR REPLACE FUNCTION public.get_user_auth_context(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout = '5s'
AS $function$
DECLARE
  _profile jsonb;
  _society jsonb;
  _roles jsonb;
  _seller_profiles jsonb;
  _society_admin jsonb;
  _builder_ids jsonb;
  _is_security_officer boolean;
  _is_worker boolean;
  _society_id uuid;
BEGIN
  SELECT to_jsonb(p.*) INTO _profile
  FROM profiles p WHERE p.id = _user_id;

  IF _profile IS NULL THEN
    RETURN jsonb_build_object('profile', null);
  END IF;

  _society_id := (_profile->>'society_id')::uuid;

  IF _society_id IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO _society
    FROM societies s WHERE s.id = _society_id;

    SELECT to_jsonb(sa.*) INTO _society_admin
    FROM society_admins sa
    WHERE sa.user_id = _user_id AND sa.society_id = _society_id;

    -- Check security officer status inline
    SELECT EXISTS (
      SELECT 1 FROM security_staff
      WHERE user_id = _user_id AND society_id = _society_id
        AND is_active = true AND deactivated_at IS NULL
    ) INTO _is_security_officer;

    -- Check worker status inline
    SELECT EXISTS (
      SELECT 1 FROM society_workers
      WHERE user_id = _user_id AND society_id = _society_id
        AND deactivated_at IS NULL AND status = 'active'
    ) INTO _is_worker;
  ELSE
    _is_security_officer := false;
    _is_worker := false;
  END IF;

  SELECT COALESCE(jsonb_agg(ur.role), '[]'::jsonb) INTO _roles
  FROM user_roles ur WHERE ur.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(sp.*) ORDER BY sp.created_at), '[]'::jsonb) INTO _seller_profiles
  FROM seller_profiles sp WHERE sp.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(bm.builder_id), '[]'::jsonb) INTO _builder_ids
  FROM builder_members bm WHERE bm.user_id = _user_id;

  RETURN jsonb_build_object(
    'profile', _profile,
    'society', _society,
    'roles', _roles,
    'seller_profiles', _seller_profiles,
    'society_admin_role', _society_admin,
    'builder_ids', _builder_ids,
    'is_security_officer', COALESCE(_is_security_officer, false),
    'is_worker', COALESCE(_is_worker, false)
  );
END;
$function$;