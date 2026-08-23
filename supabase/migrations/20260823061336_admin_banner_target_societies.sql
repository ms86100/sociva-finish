-- Admin-only society list for featured banner targeting, with live audience counts.
CREATE OR REPLACE FUNCTION public.admin_list_banner_target_societies()
RETURNS TABLE (
  id uuid,
  name text,
  is_active boolean,
  builder_id uuid,
  builder_name text,
  buyer_count bigint,
  seller_count bigint,
  is_test boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.name,
    COALESCE(s.is_active, false) AS is_active,
    s.builder_id,
    b.name AS builder_name,
    COALESCE((
      SELECT COUNT(DISTINCT p.id)
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE p.society_id = s.id
        AND ur.role = 'buyer'::public.user_role
    ), 0)::bigint AS buyer_count,
    COALESCE((
      SELECT COUNT(DISTINCT x.uid)
      FROM (
        SELECT p.id AS uid
        FROM public.profiles p
        JOIN public.user_roles ur ON ur.user_id = p.id
        WHERE p.society_id = s.id
          AND ur.role = 'seller'::public.user_role
        UNION
        SELECT sp.user_id AS uid
        FROM public.seller_profiles sp
        WHERE sp.society_id = s.id
          AND sp.user_id IS NOT NULL
      ) x
    ), 0)::bigint AS seller_count,
    (
      COALESCE(s.slug, '') ILIKE '%integration%test%'
      OR COALESCE(s.name, '') ILIKE 'Integration Test Society%'
    ) AS is_test
  FROM public.societies s
  LEFT JOIN public.builders b ON b.id = s.builder_id
  ORDER BY
    (
      COALESCE(s.slug, '') ILIKE '%integration%test%'
      OR COALESCE(s.name, '') ILIKE 'Integration Test Society%'
    ) ASC,
    COALESCE(s.is_active, false) DESC,
    s.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_banner_target_societies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_banner_target_societies() TO authenticated;
