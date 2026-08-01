
-- Fix 1: recompute_seller_stats — count 'delivered' alongside 'completed'
CREATE OR REPLACE FUNCTION public.recompute_seller_stats(_seller_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.seller_profiles SET
    completed_order_count = (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered')),
    rating = COALESCE((SELECT AVG(rating) FROM public.reviews WHERE seller_id = _seller_id AND is_hidden = false), 0),
    total_reviews = (SELECT COUNT(*) FROM public.reviews WHERE seller_id = _seller_id AND is_hidden = false),
    cancellation_rate = CASE WHEN (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id) = 0 THEN 0
      ELSE (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'cancelled')::numeric / (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id) END,
    last_active_at = now()
  WHERE id = _seller_id;
END;
$function$;

-- Fix 2: get_seller_trust_snapshot — count 'delivered' alongside 'completed'
CREATE OR REPLACE FUNCTION public.get_seller_trust_snapshot(_seller_id uuid)
 RETURNS TABLE(completed_orders bigint, cancelled_orders bigint, unique_customers bigint, repeat_customer_pct numeric, avg_response_min numeric, recent_order_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered')),
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status = 'cancelled'),
    (SELECT COUNT(DISTINCT buyer_id) FROM public.orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered')),
    CASE WHEN (SELECT COUNT(DISTINCT buyer_id) FROM public.orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered')) = 0 THEN 0::numeric
      ELSE (SELECT COUNT(DISTINCT buyer_id) FILTER (WHERE cnt > 1) * 100.0 / COUNT(DISTINCT buyer_id) FROM (SELECT buyer_id, COUNT(*) as cnt FROM public.orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered') GROUP BY buyer_id) sub) END,
    COALESCE((SELECT sp.avg_response_minutes FROM public.seller_profiles sp WHERE sp.id = _seller_id), 0)::numeric,
    (SELECT COUNT(*) FROM public.orders WHERE seller_id = _seller_id AND status IN ('completed', 'delivered') AND created_at > now() - interval '30 days');
END;
$function$;
