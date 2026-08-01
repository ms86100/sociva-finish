
CREATE OR REPLACE FUNCTION public.get_society_order_stats(
  _product_ids uuid[],
  _society_id uuid DEFAULT NULL,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _radius_km double precision DEFAULT 5
)
RETURNS TABLE(product_id uuid, families_this_week bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _box_delta double precision;
BEGIN
  -- Coordinate-based: count distinct buyers within radius
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    _box_delta := _radius_km * 0.009;

    RETURN QUERY
    SELECT oi.product_id, COUNT(DISTINCT o.buyer_id)::bigint AS families_this_week
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.delivery_addresses da ON da.user_id = o.buyer_id AND da.is_default = true
    WHERE oi.product_id = ANY(_product_ids)
      AND o.status NOT IN ('cancelled')
      AND o.created_at > now() - interval '7 days'
      AND da.latitude IS NOT NULL AND da.longitude IS NOT NULL
      AND da.latitude BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
      AND da.longitude BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
      AND public.haversine_km(_lat, _lng, da.latitude, da.longitude) <= _radius_km
    GROUP BY oi.product_id;

  -- Legacy: society-scoped counting
  ELSIF _society_id IS NOT NULL THEN
    RETURN QUERY
    SELECT oi.product_id, COUNT(DISTINCT o.buyer_id)::bigint AS families_this_week
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.profiles p ON p.id = o.buyer_id
    WHERE oi.product_id = ANY(_product_ids)
      AND p.society_id = _society_id
      AND o.status NOT IN ('cancelled')
      AND o.created_at > now() - interval '7 days'
    GROUP BY oi.product_id;
  END IF;
END;
$function$;
