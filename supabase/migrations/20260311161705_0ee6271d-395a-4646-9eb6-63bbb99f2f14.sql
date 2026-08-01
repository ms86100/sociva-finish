
-- 1. Recreate get_seller_demand_stats with commercial seller support
CREATE OR REPLACE FUNCTION public.get_seller_demand_stats(_seller_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _society_id uuid;
  _active_buyers int;
  _view_count int;
  _order_count int;
  _conversion_rate numeric;
BEGIN
  SELECT society_id INTO _society_id FROM seller_profiles WHERE id = _seller_id;

  -- Active buyers: society-scoped for society sellers, seller-scoped for commercial
  IF _society_id IS NOT NULL THEN
    SELECT COUNT(DISTINCT o.buyer_id) INTO _active_buyers
    FROM orders o
    JOIN profiles p ON p.id = o.buyer_id
    WHERE p.society_id = _society_id
      AND o.created_at > now() - interval '30 days'
      AND o.status != 'cancelled';
  ELSE
    SELECT COUNT(DISTINCT o.buyer_id) INTO _active_buyers
    FROM orders o
    WHERE o.seller_id = _seller_id
      AND o.created_at > now() - interval '30 days'
      AND o.status != 'cancelled';
  END IF;

  -- View count from search_demand_log
  SELECT COALESCE(SUM(sdl.search_count), 0) INTO _view_count
  FROM search_demand_log sdl
  WHERE (_society_id IS NOT NULL AND sdl.society_id = _society_id)
     OR (_society_id IS NULL AND EXISTS (
       SELECT 1 FROM products p WHERE p.seller_id = _seller_id AND p.category::text = sdl.search_term
     ));

  -- Order count for this seller
  SELECT COUNT(*) INTO _order_count
  FROM orders o
  WHERE o.seller_id = _seller_id
    AND o.created_at > now() - interval '30 days'
    AND o.status != 'cancelled';

  -- Conversion rate
  IF _view_count > 0 THEN
    _conversion_rate := ROUND((_order_count::numeric / _view_count) * 100, 1);
  ELSE
    _conversion_rate := 0;
  END IF;

  RETURN json_build_object(
    'active_buyers_in_society', _active_buyers,
    'view_count', _view_count,
    'order_count', _order_count,
    'conversion_rate', _conversion_rate
  );
END;
$function$;

-- 2. Drop and recreate search_demand_log RLS policy with commercial seller bypass
DROP POLICY IF EXISTS "Sellers can read unmet demand via RPC" ON public.search_demand_log;

CREATE POLICY "Sellers can read unmet demand via RPC" ON public.search_demand_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.user_id = auth.uid()
        AND (sp.society_id = search_demand_log.society_id OR sp.seller_type = 'commercial')
    )
  );
