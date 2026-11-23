-- Admin membership decisions are abuse-prone writes. Rate-limit and keep VOLATILE
-- so PostgREST does not run sociva_assert_rate_limit in a read-only txn.

CREATE OR REPLACE FUNCTION public.decide_society_membership(
  _membership_id uuid,
  _decision text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
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

  PERFORM public.sociva_assert_rate_limit(
    'decide_membership:' || v_uid::text,
    30,
    60
  );

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

REVOKE ALL ON FUNCTION public.decide_society_membership(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_society_membership(uuid, text) TO authenticated, service_role;
