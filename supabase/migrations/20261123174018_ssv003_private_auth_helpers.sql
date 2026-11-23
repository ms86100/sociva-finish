-- SSV-003: raw DEFINER helpers live in sociva_private (not PostgREST-exposed).
-- Public wrappers pin authenticated calls to auth.uid() so a resident JWT
-- cannot read another user's society, roles, or auth context.
-- RLS policies already pass auth.uid(); they keep working.
-- RPCs/triggers with no JWT still use the supplied id (service_role / owner).
-- SSV-010: GRANT EXECUTE on conversations_is_member to authenticated.

CREATE SCHEMA IF NOT EXISTS sociva_private;
REVOKE ALL ON SCHEMA sociva_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA sociva_private TO postgres, service_role;

CREATE OR REPLACE FUNCTION sociva_private.get_user_society_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.society_id
  FROM public.society_memberships m
  WHERE m.user_id = _user_id
    AND m.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION sociva_private.has_active_society_membership(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.society_memberships m
    WHERE m.user_id = _user_id
      AND m.society_id = _society_id
      AND m.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION sociva_private.has_role(_user_id uuid, _role user_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION sociva_private.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT sociva_private.has_role(_user_id, 'admin')
$$;

CREATE OR REPLACE FUNCTION sociva_private.is_society_admin(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.society_admins
    WHERE user_id = _user_id AND society_id = _society_id
  ) OR sociva_private.is_admin(_user_id)
$$;

CREATE OR REPLACE FUNCTION sociva_private.conversations_is_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = _conversation_id
      AND cm.user_id = _user_id
  )
$$;

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
BEGIN
  SELECT to_jsonb(p.*) INTO _profile
  FROM profiles p WHERE p.id = _user_id;

  IF _profile IS NULL THEN
    RETURN jsonb_build_object('profile', null);
  END IF;

  IF (_profile->>'society_id') IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO _society
    FROM societies s WHERE s.id = (_profile->>'society_id')::uuid;

    SELECT to_jsonb(sa.*) INTO _society_admin
    FROM society_admins sa
    WHERE sa.user_id = _user_id AND sa.society_id = (_profile->>'society_id')::uuid;
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
    'builder_ids', _builder_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION sociva_private.can_access_feature(_society_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_feature_enabled_for_society(_society_id, _feature_key);
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sociva_private FROM PUBLIC, anon, authenticated;

-- Public wrappers: authenticated JWT always uses auth.uid().

CREATE OR REPLACE FUNCTION public.get_user_society_id(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN NULL;
  END IF;
  IF auth.role() = 'authenticated' THEN
    RETURN sociva_private.get_user_society_id(auth.uid());
  END IF;
  RETURN sociva_private.get_user_society_id(_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_active_society_membership(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN false;
  END IF;
  IF auth.role() = 'authenticated' THEN
    RETURN sociva_private.has_active_society_membership(auth.uid(), _society_id);
  END IF;
  RETURN sociva_private.has_active_society_membership(_user_id, _society_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role user_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN false;
  END IF;
  IF auth.role() = 'authenticated' THEN
    RETURN sociva_private.has_role(auth.uid(), _role);
  END IF;
  RETURN sociva_private.has_role(_user_id, _role);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN false;
  END IF;
  IF auth.role() = 'authenticated' THEN
    RETURN sociva_private.is_admin(auth.uid());
  END IF;
  RETURN sociva_private.is_admin(_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_society_admin(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN false;
  END IF;
  IF auth.role() = 'authenticated' THEN
    RETURN sociva_private.is_society_admin(auth.uid(), _society_id);
  END IF;
  RETURN sociva_private.is_society_admin(_user_id, _society_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_is_member(_conversation_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN false;
  END IF;
  IF auth.role() = 'authenticated' THEN
    RETURN sociva_private.conversations_is_member(_conversation_id, auth.uid());
  END IF;
  RETURN sociva_private.conversations_is_member(_conversation_id, _user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_auth_context(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
SET statement_timeout TO '5s'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF auth.role() = 'authenticated' THEN
    IF _user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;
    RETURN sociva_private.get_user_auth_context(auth.uid());
  END IF;
  RETURN sociva_private.get_user_auth_context(_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_feature(_society_id uuid, _feature_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN false;
  END IF;
  IF auth.role() = 'authenticated' AND NOT sociva_private.is_admin(auth.uid()) THEN
    IF _society_id IS DISTINCT FROM sociva_private.get_user_society_id(auth.uid()) THEN
      RETURN false;
    END IF;
  END IF;
  RETURN sociva_private.can_access_feature(_society_id, _feature_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id uuid)
RETURNS TABLE(
  feature_key text,
  display_name text,
  is_enabled boolean,
  source text,
  society_configurable boolean,
  description text,
  icon_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _builder_id uuid;
  _builder_package_id uuid;
BEGIN
  IF auth.role() = 'anon' THEN
    RETURN;
  END IF;
  IF auth.role() = 'authenticated'
     AND NOT sociva_private.is_admin(auth.uid())
     AND _society_id IS DISTINCT FROM sociva_private.get_user_society_id(auth.uid()) THEN
    RETURN;
  END IF;

  SELECT bs.builder_id
  INTO _builder_id
  FROM public.builder_societies bs
  WHERE bs.society_id = _society_id
  LIMIT 1;

  IF _builder_id IS NOT NULL THEN
    SELECT bfp.package_id
    INTO _builder_package_id
    FROM public.builder_feature_packages bfp
    WHERE bfp.builder_id = _builder_id
      AND (bfp.expires_at IS NULL OR bfp.expires_at > now())
    ORDER BY bfp.assigned_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  RETURN QUERY
  WITH package_hits AS (
    SELECT
      pf.id AS feature_id,
      pf.feature_key,
      COALESCE(pf.display_name, pf.feature_name, pf.feature_key) AS display_name,
      pf.description,
      pf.icon_name,
      pf.is_core,
      pf.society_configurable,
      fpi.enabled AS package_enabled,
      'package'::text AS hit_source,
      fp.is_default
    FROM public.platform_features pf
    JOIN public.feature_package_items fpi ON fpi.feature_id = pf.id AND fpi.enabled = true
    JOIN public.feature_packages fp ON fp.id = fpi.package_id AND fp.is_active = true
    WHERE pf.is_active = true
      AND (
        fp.is_default = true
        OR (_builder_package_id IS NOT NULL AND fp.id = _builder_package_id)
        OR EXISTS (
          SELECT 1
          FROM public.builder_feature_packages bfp2
          WHERE bfp2.builder_id = _builder_id
            AND bfp2.package_id = fp.id
            AND (bfp2.expires_at IS NULL OR bfp2.expires_at > now())
        )
      )
  ),
  ranked AS (
    SELECT DISTINCT ON (ph.feature_key)
      ph.feature_id,
      ph.feature_key,
      ph.display_name,
      ph.description,
      ph.icon_name,
      ph.is_core,
      ph.society_configurable,
      ph.package_enabled,
      ph.hit_source
    FROM package_hits ph
    ORDER BY ph.feature_key, ph.is_default DESC
  )
  SELECT
    r.feature_key,
    r.display_name,
    CASE
      WHEN r.is_core THEN true
      WHEN sfo.id IS NOT NULL THEN sfo.is_enabled
      ELSE COALESCE(r.package_enabled, false)
    END AS is_enabled,
    CASE
      WHEN r.is_core THEN 'core'
      WHEN sfo.id IS NOT NULL THEN 'override'
      ELSE r.hit_source
    END AS source,
    CASE
      WHEN r.is_core THEN false
      WHEN COALESCE(r.society_configurable, true) = false THEN false
      ELSE true
    END AS society_configurable,
    r.description,
    r.icon_name
  FROM ranked r
  LEFT JOIN public.society_feature_overrides sfo
    ON sfo.feature_id = r.feature_id
   AND sfo.society_id = _society_id
  ORDER BY r.feature_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_write_to_society(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'sociva_private', 'public'
AS $$
DECLARE
  v_uid uuid := _user_id;
BEGIN
  IF auth.role() = 'authenticated' THEN
    v_uid := auth.uid();
  ELSIF auth.role() = 'anon' THEN
    RETURN false;
  END IF;
  RETURN
    sociva_private.is_admin(v_uid)
    OR sociva_private.is_society_admin(v_uid, _society_id)
    OR public.is_builder_for_society(v_uid, _society_id)
    OR sociva_private.has_active_society_membership(v_uid, _society_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_society_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_society_membership(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, user_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_society_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conversations_is_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_auth_context(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_feature(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_effective_society_features(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_to_society(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_society_membership(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, user_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_society_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversations_is_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_auth_context(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_feature(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_society_features(uuid) TO authenticated, service_role;
