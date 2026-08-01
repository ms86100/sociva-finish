-- Task 2: RPC to get society-scoped order stats for social proof
-- Returns per-product: families_this_week (distinct buyer count in last 7 days from same society)
CREATE OR REPLACE FUNCTION public.get_society_order_stats(
  _product_ids uuid[],
  _society_id uuid
)
RETURNS TABLE(product_id uuid, families_this_week bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5s'
AS $$
  SELECT 
    oi.product_id,
    COUNT(DISTINCT o.buyer_id) AS families_this_week
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN profiles p ON p.id = o.buyer_id
  WHERE oi.product_id = ANY(_product_ids)
    AND p.society_id = _society_id
    AND o.created_at >= now() - interval '7 days'
    AND o.status NOT IN ('cancelled')
  GROUP BY oi.product_id
  HAVING COUNT(DISTINCT o.buyer_id) > 0
$$;