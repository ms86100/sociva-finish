-- SSV-001 follow-up (staging): lock remaining privileged profile columns.
-- authenticated may UPDATE only display/prefs fields.
-- authenticated may INSERT a new own-row without society_id / verification_status /
-- phone_verified. Phone and email are INSERT-once (OTP path / first profile), not UPDATE.
-- Already-active membership requests refresh profiles.society_id cache (DEFINER).

REVOKE INSERT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

GRANT INSERT (
  id,
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
  created_at,
  updated_at
) ON public.profiles TO authenticated;

GRANT UPDATE (
  name,
  flat_number,
  block,
  avatar_url,
  phase,
  browse_beyond_community,
  search_radius_km,
  latitude,
  longitude,
  has_seen_onboarding,
  tower_id,
  unit_id,
  updated_at
) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.request_society_membership(
  _society_id uuid,
  _invite_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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

  PERFORM public.sociva_assert_rate_limit('membership_request:' || v_uid::text, 8, 3600);

  SELECT * INTO v_soc FROM public.societies WHERE id = _society_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Society not found';
  END IF;
  IF COALESCE(v_soc.is_active, false) IS NOT TRUE
     OR COALESCE(v_soc.is_verified, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only approved societies can be joined';
  END IF;

  SELECT * INTO v_existing
  FROM public.society_memberships
  WHERE user_id = v_uid AND society_id = _society_id;

  -- Already active here: refresh cache even if the client omitted invite_code.
  IF v_existing.status = 'active' THEN
    PERFORM set_config('app.allow_society_change', 'true', true);
    UPDATE public.profiles
    SET society_id = _society_id
    WHERE id = v_uid
      AND society_id IS DISTINCT FROM _society_id;
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'active',
      'society_id', _society_id,
      'membership_id', v_existing.id
    );
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

  IF v_existing.status IN ('suspended', 'removed') THEN
    RAISE EXCEPTION 'Membership is not eligible to rejoin';
  END IF;

  v_status := CASE
    WHEN COALESCE(v_soc.auto_approve_residents, false) THEN 'active'
    ELSE 'pending'
  END;

  IF v_existing.id IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.request_society_membership(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_society_membership(uuid, text) TO authenticated;
