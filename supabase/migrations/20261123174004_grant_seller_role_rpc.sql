-- SSV-002 follow-up: residents cannot self-insert role=seller.
-- Opening a store only inserts seller_profiles (draft). The seller role is
-- granted on admin/society-admin approval through this RPC.

CREATE OR REPLACE FUNCTION public.grant_seller_role(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_society uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  PERFORM public.sociva_assert_rate_limit('grant_seller_role:' || v_caller::text, 30, 60);

  SELECT sp.society_id
  INTO v_society
  FROM public.seller_profiles sp
  WHERE sp.user_id = _user_id
  ORDER BY
    CASE sp.verification_status
      WHEN 'pending' THEN 0
      WHEN 'approved' THEN 1
      WHEN 'draft' THEN 2
      ELSE 3
    END,
    sp.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No seller profile for this user' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_admin(v_caller)
    OR (v_society IS NOT NULL AND public.is_society_admin(v_caller, v_society))
  ) THEN
    RAISE EXCEPTION 'Not authorized to grant seller role' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'seller'::user_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'user_id', _user_id, 'role', 'seller');
END;
$$;

REVOKE ALL ON FUNCTION public.grant_seller_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_seller_role(uuid) TO authenticated;
