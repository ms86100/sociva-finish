
-- RPC to get product-level trust metrics (order counts, recency, unique buyers)
CREATE OR REPLACE FUNCTION public.get_product_trust_metrics(_product_ids uuid[])
RETURNS TABLE(
  product_id uuid,
  total_orders integer,
  unique_buyers integer,
  last_ordered_at timestamptz,
  repeat_buyer_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5s'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    oi.product_id,
    COUNT(DISTINCT o.id)::integer AS total_orders,
    COUNT(DISTINCT o.buyer_id)::integer AS unique_buyers,
    MAX(o.created_at) AS last_ordered_at,
    (
      SELECT COUNT(*)::integer
      FROM (
        SELECT o2.buyer_id
        FROM order_items oi2
        JOIN orders o2 ON o2.id = oi2.order_id
        WHERE oi2.product_id = oi.product_id
          AND o2.status IN ('completed', 'delivered', 'accepted', 'preparing', 'ready')
        GROUP BY o2.buyer_id
        HAVING COUNT(*) >= 2
      ) repeat_buyers
    ) AS repeat_buyer_count
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = ANY(_product_ids)
    AND o.status IN ('completed', 'delivered', 'accepted', 'preparing', 'ready')
  GROUP BY oi.product_id;
END;
$$;

-- RPC to get seller trust snapshot (for product detail page)
CREATE OR REPLACE FUNCTION public.get_seller_trust_snapshot(_seller_id uuid)
RETURNS TABLE(
  completed_orders integer,
  avg_response_min integer,
  repeat_customer_pct numeric,
  unique_customers integer,
  recent_order_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5s'
AS $$
DECLARE
  _total_orders integer;
  _completed integer;
  _unique integer;
  _repeat integer;
BEGIN
  SELECT COUNT(*) INTO _completed
  FROM orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered');

  SELECT COUNT(DISTINCT buyer_id) INTO _unique
  FROM orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered');

  SELECT COUNT(*) INTO _repeat
  FROM (
    SELECT buyer_id FROM orders
    WHERE seller_id = _seller_id AND status IN ('completed', 'delivered')
    GROUP BY buyer_id HAVING COUNT(*) >= 2
  ) r;

  SELECT COUNT(*) INTO _total_orders
  FROM orders WHERE seller_id = _seller_id
    AND status IN ('completed', 'delivered')
    AND created_at > now() - interval '30 days';

  RETURN QUERY SELECT
    _completed,
    COALESCE((SELECT avg_response_minutes FROM seller_profiles WHERE id = _seller_id), 0)::integer,
    CASE WHEN _unique > 0 THEN ROUND((_repeat::numeric / _unique) * 100, 0) ELSE 0 END,
    _unique,
    _total_orders;
END;
$$;
