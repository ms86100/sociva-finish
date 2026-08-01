
CREATE OR REPLACE FUNCTION public.get_location_stats(
  _lat double precision,
  _lng double precision,
  _radius_km double precision DEFAULT 5
)
RETURNS TABLE(sellers_count bigint, orders_today bigint, societies_count bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH nearby_sellers AS (
    SELECT sp.id AS seller_id, sp.society_id
    FROM public.seller_profiles sp
    JOIN public.societies s ON s.id = sp.society_id
    WHERE sp.verification_status = 'approved'
      AND sp.is_available = true
      AND s.latitude IS NOT NULL
      AND s.longitude IS NOT NULL
      AND public.haversine_km(_lat, _lng, s.latitude, s.longitude) <= _radius_km
  )
  SELECT
    (SELECT COUNT(*) FROM nearby_sellers)::bigint,
    (SELECT COUNT(*)
     FROM public.orders o
     WHERE o.seller_id IN (SELECT ns.seller_id FROM nearby_sellers ns)
       AND o.created_at > now() - interval '24 hours'
       AND o.status NOT IN ('cancelled')
    )::bigint,
    (SELECT COUNT(DISTINCT ns.society_id) FROM nearby_sellers ns)::bigint;
END;
$$;
