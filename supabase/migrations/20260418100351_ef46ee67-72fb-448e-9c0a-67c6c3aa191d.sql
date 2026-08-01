CREATE OR REPLACE FUNCTION public.fn_get_seller_user_id(p_seller_profile_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.seller_profiles WHERE id = p_seller_profile_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_seller_user_id(uuid) TO authenticated, anon;