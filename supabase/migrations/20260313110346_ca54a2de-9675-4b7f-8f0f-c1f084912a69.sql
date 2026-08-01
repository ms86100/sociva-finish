CREATE OR REPLACE FUNCTION public.get_seller_trust_snapshot(_seller_id uuid)
 RETURNS TABLE(completed_orders bigint, cancelled_orders bigint, unique_customers bigint, repeat_customer_pct numeric, avg_response_min numeric, recent_order_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed'),
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'cancelled'),
    (SELECT COUNT(DISTINCT buyer_id) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed'),
    CASE WHEN (SELECT COUNT(DISTINCT buyer_id) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed') = 0 THEN 0::numeric
      ELSE (SELECT COUNT(DISTINCT buyer_id) FILTER (WHERE cnt > 1) * 100.0 / COUNT(DISTINCT buyer_id) FROM (SELECT buyer_id, COUNT(*) as cnt FROM public.orders WHERE seller_id = _seller_id AND status = 'completed' GROUP BY buyer_id) sub) END,
    COALESCE((SELECT sp.avg_response_minutes FROM public.seller_profiles sp WHERE sp.id = _seller_id), 0)::numeric,
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'completed' AND created_at > now() - interval '30 days');
END;
$function$;