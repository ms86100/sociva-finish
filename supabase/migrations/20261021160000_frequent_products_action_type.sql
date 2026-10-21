-- Route Order again by commerce mode. category + action_type are the
-- split signal. Book and contact repeats must not default onto Home.

DROP FUNCTION IF EXISTS public.get_user_frequent_products(uuid, integer);

CREATE FUNCTION public.get_user_frequent_products(
  _user_id uuid,
  _limit integer DEFAULT 12
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  price numeric,
  image_url text,
  seller_id uuid,
  seller_name text,
  order_count bigint,
  category text,
  action_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.price,
    p.image_url,
    p.seller_id,
    sp.business_name,
    COUNT(*)::bigint AS order_count,
    p.category::text,
    p.action_type
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.buyer_id = _user_id
    AND o.status = 'completed'
    AND p.is_available = true
    AND public.seller_is_eligible_for_discovery(p.seller_id)
  GROUP BY p.id, p.name, p.price, p.image_url, p.seller_id, sp.business_name, p.category, p.action_type
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_frequent_products(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_frequent_products(uuid, integer) TO service_role;
