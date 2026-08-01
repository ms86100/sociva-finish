
-- 1. Fix coupons SELECT policy: allow buyers to see active coupons from any seller (marketplace-safe)
DROP POLICY IF EXISTS "Users can view active coupons in their society" ON public.coupons;
CREATE POLICY "Buyers can view active coupons"
  ON public.coupons FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND starts_at <= now()
  );

-- 2. Replace get_unmet_demand with seller-scoped version for commercial sellers
CREATE OR REPLACE FUNCTION public.get_unmet_demand(_society_id uuid, _seller_id uuid DEFAULT NULL)
 RETURNS TABLE(search_term text, search_count bigint, last_searched timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sdl.search_term, COUNT(*)::bigint, MAX(sdl.searched_at)
  FROM public.search_demand_log sdl
  WHERE
    CASE
      -- If society provided, scope to that society
      WHEN _society_id IS NOT NULL THEN sdl.society_id = _society_id
      -- If seller_id provided (commercial seller), scope to societies where they have orders
      WHEN _seller_id IS NOT NULL THEN (
        sdl.society_id IS NULL
        OR sdl.society_id IN (
          SELECT DISTINCT o.society_id FROM public.orders o
          WHERE o.seller_id = _seller_id AND o.society_id IS NOT NULL
        )
      )
      -- Fallback: only null-society logs
      ELSE sdl.society_id IS NULL
    END
  GROUP BY sdl.search_term
  ORDER BY COUNT(*) DESC LIMIT 20;
END;
$function$;
