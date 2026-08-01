
DROP FUNCTION IF EXISTS public.search_sellers_by_location(double precision, double precision, double precision, text, text, uuid);

CREATE OR REPLACE FUNCTION public.search_sellers_by_location(_lat double precision, _lng double precision, _radius_km double precision DEFAULT 5, _search_term text DEFAULT NULL::text, _category text DEFAULT NULL::text, _exclude_society_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(seller_id uuid, user_id uuid, business_name text, description text, categories text[], primary_group text, cover_image_url text, profile_image_url text, is_available boolean, is_featured boolean, rating numeric, total_reviews integer, matching_products json, distance_km double precision, society_name text, availability_start time without time zone, availability_end time without time zone, seller_latitude double precision, seller_longitude double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    sp.id AS seller_id,
    sp.user_id,
    sp.business_name,
    sp.description,
    ARRAY(SELECT unnest(sp.categories)::text) AS categories,
    sp.primary_group,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.is_available,
    sp.is_featured,
    sp.rating,
    sp.total_reviews,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', p.id,
        'name', p.name,
        'price', p.price,
        'image_url', p.image_url,
        'category', p.category,
        'is_veg', p.is_veg,
        'action_type', p.action_type,
        'contact_phone', p.contact_phone,
        'mrp', p.mrp,
        'discount_percentage', p.discount_percentage
      ))
      FROM public.products p
      WHERE p.seller_id = sp.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
      ), '[]'::json
    ) AS matching_products,
    public.haversine_km(_lat, _lng, s.latitude, s.longitude) AS distance_km,
    s.name AS society_name,
    sp.availability_start,
    sp.availability_end,
    s.latitude AS seller_latitude,
    s.longitude AS seller_longitude
  FROM public.seller_profiles sp
  JOIN public.societies s ON s.id = sp.society_id
  WHERE sp.verification_status = 'approved'
    AND sp.is_available = true
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND public.haversine_km(_lat, _lng, s.latitude, s.longitude) <= LEAST(_radius_km, COALESCE(sp.delivery_radius_km, _radius_km))
    AND (_exclude_society_id IS NULL OR sp.society_id != _exclude_society_id)
    AND (sp.sell_beyond_community = true OR sp.society_id = (
      SELECT p2.society_id FROM public.profiles p2 WHERE p2.id = auth.uid()
    ))
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.seller_id = sp.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
    )
    AND (_search_term IS NULL OR sp.business_name ILIKE '%' || _search_term || '%'
      OR EXISTS (SELECT 1 FROM public.products p2 WHERE p2.seller_id = sp.id AND p2.is_available = true AND p2.name ILIKE '%' || _search_term || '%'))
  ORDER BY public.haversine_km(_lat, _lng, s.latitude, s.longitude);
END;
$function$;
