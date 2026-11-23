-- GO-VM Phase 1: society membership as the authorization source.
-- Apply to staging (wwuanzbusxoyzixuprxs) only. Do not apply to production
-- until the two-society matrix is green and a production PR is approved.

CREATE TABLE IF NOT EXISTS public.society_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  society_id uuid NOT NULL REFERENCES public.societies(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'suspended', 'removed')),
  invite_verified boolean NOT NULL DEFAULT false,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, society_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS society_memberships_one_active_user
  ON public.society_memberships (user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS society_memberships_society_status_idx
  ON public.society_memberships (society_id, status);

ALTER TABLE public.society_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.society_memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS society_memberships_select_own ON public.society_memberships;
CREATE POLICY society_memberships_select_own
  ON public.society_memberships
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.is_society_admin(auth.uid(), society_id)
  );

REVOKE INSERT, UPDATE, DELETE ON public.society_memberships FROM anon, authenticated;
GRANT SELECT ON public.society_memberships TO authenticated;

INSERT INTO public.society_memberships (user_id, society_id, status, requested_at, decided_at)
SELECT
  p.id,
  p.society_id,
  CASE
    WHEN p.verification_status = 'approved' THEN 'active'
    ELSE 'pending'
  END,
  COALESCE(p.created_at, now()),
  CASE WHEN p.verification_status = 'approved' THEN now() ELSE NULL END
FROM public.profiles p
WHERE p.society_id IS NOT NULL
ON CONFLICT (user_id, society_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_user_society_id(_user_id uuid)
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

CREATE OR REPLACE FUNCTION public.has_active_society_membership(_user_id uuid, _society_id uuid)
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

CREATE OR REPLACE FUNCTION public.can_write_to_society(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_admin(_user_id)
    OR public.is_society_admin(_user_id, _society_id)
    OR public.is_builder_for_society(_user_id, _society_id)
    OR public.has_active_society_membership(_user_id, _society_id)
$$;

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('authenticated', 'anon') THEN
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

CREATE OR REPLACE FUNCTION public.request_society_membership(
  _society_id uuid,
  _invite_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_soc public.societies%ROWTYPE;
  v_existing public.society_memberships%ROWTYPE;
  v_status text;
  v_invite_ok boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _society_id IS NULL THEN
    RAISE EXCEPTION 'society_id required';
  END IF;

  SELECT * INTO v_soc FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Society not found';
  END IF;
  IF COALESCE(v_soc.is_active, false) IS NOT TRUE
     OR COALESCE(v_soc.is_verified, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only approved societies can be joined';
  END IF;

  IF NULLIF(btrim(COALESCE(v_soc.invite_code, '')), '') IS NOT NULL THEN
    IF lower(btrim(COALESCE(_invite_code, ''))) IS DISTINCT FROM lower(btrim(v_soc.invite_code)) THEN
      RAISE EXCEPTION 'invite_required' USING ERRCODE = '42501';
    END IF;
    v_invite_ok := true;
  ELSE
    v_invite_ok := true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.society_memberships
    WHERE user_id = v_uid
      AND status = 'active'
      AND society_id IS DISTINCT FROM _society_id
  ) THEN
    RAISE EXCEPTION 'Already an active member of another society';
  END IF;

  SELECT * INTO v_existing
  FROM public.society_memberships
  WHERE user_id = v_uid AND society_id = _society_id;

  IF v_existing.status IN ('suspended', 'removed') THEN
    RAISE EXCEPTION 'Membership is not eligible to rejoin';
  END IF;

  v_status := CASE
    WHEN COALESCE(v_soc.auto_approve_residents, false) THEN 'active'
    ELSE 'pending'
  END;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.status = 'active' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'status', 'active',
        'society_id', _society_id,
        'membership_id', v_existing.id
      );
    END IF;
    UPDATE public.society_memberships
    SET status = v_status,
        invite_verified = v_invite_ok,
        requested_at = now(),
        updated_at = now(),
        decided_at = CASE WHEN v_status = 'active' THEN now() ELSE NULL END
    WHERE id = v_existing.id
    RETURNING * INTO v_existing;
  ELSE
    INSERT INTO public.society_memberships (
      user_id, society_id, status, invite_verified, decided_at
    )
    VALUES (
      v_uid, _society_id, v_status, v_invite_ok,
      CASE WHEN v_status = 'active' THEN now() ELSE NULL END
    )
    RETURNING * INTO v_existing;
  END IF;

  PERFORM set_config('app.allow_society_change', 'true', true);
  IF v_status = 'active' THEN
    PERFORM set_config('app.allow_verification_change', 'true', true);
    UPDATE public.profiles
    SET society_id = _society_id,
        verification_status = 'approved'
    WHERE id = v_uid;
  ELSE
    UPDATE public.profiles
    SET society_id = _society_id
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_existing.status,
    'society_id', _society_id,
    'membership_id', v_existing.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_society_membership(
  _membership_id uuid,
  _decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.society_memberships%ROWTYPE;
  v_new text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_new := lower(btrim(COALESCE(_decision, '')));
  IF v_new NOT IN ('active', 'rejected', 'suspended', 'removed') THEN
    RAISE EXCEPTION 'Invalid membership decision';
  END IF;

  SELECT * INTO v_row FROM public.society_memberships WHERE id = _membership_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;
  IF NOT (
    public.is_admin(v_uid)
    OR public.is_society_admin(v_uid, v_row.society_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.society_memberships
  SET status = v_new,
      decided_at = now(),
      decided_by = v_uid,
      updated_at = now()
  WHERE id = _membership_id
  RETURNING * INTO v_row;

  PERFORM set_config('app.allow_society_change', 'true', true);
  PERFORM set_config('app.allow_verification_change', 'true', true);

  IF v_new = 'active' THEN
    UPDATE public.profiles
    SET society_id = v_row.society_id,
        verification_status = 'approved'
    WHERE id = v_row.user_id;
  ELSE
    UPDATE public.profiles
    SET verification_status = CASE
      WHEN v_new = 'rejected' THEN 'rejected'
      ELSE verification_status
    END
    WHERE id = v_row.user_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'membership_id', v_row.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.conversations_is_approved_resident(_user_id uuid, _society_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.society_memberships m ON m.user_id = p.id
    WHERE p.id = _user_id
      AND m.society_id = _society_id
      AND m.status = 'active'
      AND p.verification_status = 'approved'
  )
$$;

REVOKE ALL ON FUNCTION public.request_society_membership(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_society_membership(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.decide_society_membership(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_society_membership(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.has_active_society_membership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_society_membership(uuid, uuid) TO authenticated;

COMMENT ON TABLE public.society_memberships IS
  'Authoritative society membership. profiles.society_id is a cache of the active membership society.';
