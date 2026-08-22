-- Extend admin store credit lookup: search by seller phone and return phone on rows.

CREATE OR REPLACE FUNCTION public.admin_list_seller_credits(p_search text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x))
    FROM (
      SELECT
        sp.id AS seller_id,
        sp.business_name,
        pr.phone AS seller_phone,
        COALESCE(a.available, 0) AS available,
        COALESCE(a.reserved, 0) AS reserved,
        COALESCE(a.lifetime_purchased, 0) AS lifetime_purchased,
        COALESCE(a.lifetime_consumed, 0) AS lifetime_consumed,
        COALESCE(a.lifetime_adjusted, 0) AS lifetime_adjusted,
        (
          SELECT max(p.created_at)
          FROM public.seller_credit_purchases p
          WHERE p.seller_id = sp.id AND p.status = 'captured'
        ) AS last_recharge_at
      FROM public.seller_profiles sp
      LEFT JOIN public.profiles pr ON pr.id = sp.user_id
      LEFT JOIN public.seller_credit_accounts a ON a.seller_id = sp.id
      WHERE p_search IS NULL
         OR btrim(p_search) = ''
         OR sp.business_name ILIKE '%' || btrim(p_search) || '%'
         OR sp.id::text ILIKE '%' || btrim(p_search) || '%'
         OR COALESCE(pr.phone, '') ILIKE '%' || btrim(p_search) || '%'
      ORDER BY sp.business_name
      LIMIT 200
    ) x
  ), '[]'::jsonb);
END;
$$;
