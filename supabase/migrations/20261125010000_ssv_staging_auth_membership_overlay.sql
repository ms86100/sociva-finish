-- Staging only. Overlay active membership onto get_user_auth_context so
-- existing residents are not sent through join. Keep STABLE (no rate-limit write).
-- Public wrapper stays JWT-pinned in 20261124004000.

CREATE OR REPLACE FUNCTION sociva_private.get_user_auth_context(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5s'
AS $$
DECLARE
  _profile jsonb;
  _society jsonb;
  _roles jsonb;
  _seller_profiles jsonb;
  _society_admin jsonb;
  _builder_ids jsonb;
  _society_id uuid;
  _membership_society uuid;
  _is_security_officer boolean := false;
  _is_worker boolean := false;
BEGIN
  SELECT to_jsonb(p.*) INTO _profile
  FROM profiles p WHERE p.id = _user_id;

  IF _profile IS NULL THEN
    RETURN jsonb_build_object('profile', null);
  END IF;

  SELECT m.society_id INTO _membership_society
  FROM public.society_memberships m
  WHERE m.user_id = _user_id
    AND m.status = 'active'
  LIMIT 1;

  IF _membership_society IS NOT NULL THEN
    _profile := jsonb_set(_profile, '{society_id}', to_jsonb(_membership_society));
  END IF;

  _society_id := NULLIF(_profile->>'society_id', '')::uuid;

  IF _society_id IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO _society
    FROM societies s WHERE s.id = _society_id;

    SELECT to_jsonb(sa.*) INTO _society_admin
    FROM society_admins sa
    WHERE sa.user_id = _user_id AND sa.society_id = _society_id;

    SELECT EXISTS (
      SELECT 1 FROM security_staff
      WHERE user_id = _user_id AND society_id = _society_id
        AND is_active = true AND deactivated_at IS NULL
    ) INTO _is_security_officer;

    SELECT EXISTS (
      SELECT 1 FROM society_workers
      WHERE user_id = _user_id AND society_id = _society_id
        AND deactivated_at IS NULL AND status = 'active'
    ) INTO _is_worker;
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
$$;

-- Keep profile cache aligned with active membership. Do not copy pending rows.
UPDATE public.profiles p
SET society_id = m.society_id,
    updated_at = now()
FROM public.society_memberships m
WHERE m.user_id = p.id
  AND m.status = 'active'
  AND p.society_id IS DISTINCT FROM m.society_id;

-- Staging tester societies: invite still required when set; auto-approve after invite.
UPDATE public.societies
SET auto_approve_residents = true
WHERE is_active
  AND is_verified
  AND name IN (
    'Lakeview Proof Residency',
    'Shriram Greenfield',
    'Shriram Greenfield Phase-2, Tower H'
  );
