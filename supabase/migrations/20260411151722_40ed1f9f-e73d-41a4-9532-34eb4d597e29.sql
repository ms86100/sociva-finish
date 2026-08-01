CREATE OR REPLACE FUNCTION public.resolve_banner_products(
  p_mode text,
  p_value text,
  p_society_id uuid,
  p_buyer_lat double precision DEFAULT NULL::double precision,
  p_buyer_lng double precision DEFAULT NULL::double precision,
  p_limit integer DEFAULT 20,
  p_banner_id uuid DEFAULT NULL
)
 RETURNS TABLE(id uuid, name text, price numeric, mrp numeric, image_url text, category text, is_veg boolean, is_available boolean, is_bestseller boolean, stock_quantity integer, low_stock_threshold integer, seller_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _society_lat double precision;
  _society_lng double precision;
BEGIN
  IF p_society_id IS NOT NULL THEN
    SELECT s.latitude, s.longitude
    INTO _society_lat, _society_lng
    FROM public.societies s
    WHERE s.id = p_society_id;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.price, p.mrp, p.image_url,
    p.category::text, p.is_veg, p.is_available, p.is_bestseller,
    p.stock_quantity, p.low_stock_threshold, p.seller_id
  FROM public.products p
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE
    p.is_available = true
    AND p.approval_status = 'approved'
    AND p.stock_quantity > 0
    AND sp.is_available = true
    AND sp.verification_status = 'approved'
    -- Society / radius eligibility
    AND (
      p_society_id IS NULL
      OR sp.society_id = p_society_id
      OR (
        sp.society_id IS DISTINCT FROM p_society_id
        AND (sp.society_id IS NULL OR sp.sell_beyond_community = true)
        AND sp.latitude IS NOT NULL AND _society_lat IS NOT NULL
        AND public.haversine_km(sp.latitude, sp.longitude, _society_lat, _society_lng)
            <= COALESCE(sp.delivery_radius_km, 0)
      )
    )
    AND (
      p_buyer_lat IS NULL OR p_buyer_lng IS NULL
      OR sp.latitude IS NULL OR sp.longitude IS NULL
      OR public.haversine_km(sp.latitude, sp.longitude, p_buyer_lat, p_buyer_lng)
          <= COALESCE(sp.delivery_radius_km, 0)
    )
    -- Seller participation enforcement (backward-compatible)
    AND (
      p_banner_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.festival_seller_participation fsp WHERE fsp.banner_id = p_banner_id)
      OR EXISTS (SELECT 1 FROM public.festival_seller_participation fsp WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = true)
    )
    -- Mode filter
    AND (
      CASE p_mode
        WHEN 'category' THEN p.category::text = p_value
        WHEN 'search' THEN p.search_vector @@ plainto_tsquery('english', COALESCE(p_value, ''))
        WHEN 'popular' THEN p.is_bestseller = true
        ELSE true
      END
    )
  ORDER BY
    (p.stock_quantity > 0)::int DESC,
    p.is_bestseller DESC,
    p.is_recommended DESC,
    p.price ASC
  LIMIT p_limit;
END;
$function$;