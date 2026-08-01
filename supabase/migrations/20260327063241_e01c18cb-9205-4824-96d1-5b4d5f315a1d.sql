
-- Phase 2: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_seller_available_approved 
  ON products(seller_id, is_available, approval_status);

CREATE INDEX IF NOT EXISTS idx_seller_profiles_geo_verified 
  ON seller_profiles(latitude, longitude) 
  WHERE verification_status = 'approved' AND is_available = true;

CREATE INDEX IF NOT EXISTS idx_orders_buyer_status_created 
  ON orders(buyer_id, status, created_at DESC);

-- Phase 2: Replace search_sellers_by_location with CTE + product flags
CREATE OR REPLACE FUNCTION public.search_sellers_by_location(
  _lat double precision, _lng double precision, 
  _radius_km double precision DEFAULT 5, 
  _search_term text DEFAULT NULL::text, 
  _category text DEFAULT NULL::text, 
  _exclude_society_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  seller_id uuid, user_id uuid, business_name text, description text, 
  categories text[], primary_group text, cover_image_url text, profile_image_url text, 
  is_available boolean, is_featured boolean, rating numeric, total_reviews integer, 
  matching_products json, distance_km double precision, society_name text, 
  availability_start time without time zone, availability_end time without time zone, 
  seller_latitude double precision, seller_longitude double precision, 
  operating_days text[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _box_delta double precision;
  _term text;
  _term_pattern text;
  _matching_categories text[];
  _caller_society_id uuid;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN; END IF;
  _box_delta := _radius_km * 0.009;

  _term := NULLIF(TRIM(LOWER(_search_term)), '');
  _term_pattern := '%' || _term || '%';

  SELECT pr.society_id INTO _caller_society_id
  FROM public.profiles pr WHERE pr.id = auth.uid();

  IF _term IS NOT NULL THEN
    SELECT ARRAY(
      SELECT cc.category::text
      FROM public.category_config cc
      WHERE cc.is_active = true
        AND (cc.category::text ILIKE _term_pattern
             OR cc.display_name ILIKE _term_pattern)
    ) INTO _matching_categories;
  END IF;

  RETURN QUERY
  WITH nearby_sellers AS (
    SELECT
      sp.id, sp.user_id AS sp_user_id, sp.business_name AS sp_business_name, 
      sp.description AS sp_description,
      ARRAY(SELECT unnest(sp.categories)::text) AS sp_categories,
      sp.primary_group AS sp_primary_group, sp.cover_image_url AS sp_cover_image_url, 
      sp.profile_image_url AS sp_profile_image_url,
      sp.is_available AS sp_is_available, sp.is_featured AS sp_is_featured, 
      sp.rating AS sp_rating, sp.total_reviews AS sp_total_reviews,
      sp.availability_start AS sp_availability_start, sp.availability_end AS sp_availability_end,
      sp.operating_days::text[] AS sp_operating_days,
      COALESCE(sp.latitude, s.latitude::double precision) AS resolved_lat,
      COALESCE(sp.longitude, s.longitude::double precision) AS resolved_lng,
      public.haversine_km(_lat, _lng,
        COALESCE(sp.latitude, s.latitude::double precision),
        COALESCE(sp.longitude, s.longitude::double precision)
      ) AS computed_distance_km,
      s.name AS resolved_society_name,
      sp.delivery_radius_km AS sp_delivery_radius_km,
      sp.society_id AS sp_society_id,
      sp.seller_type AS sp_seller_type,
      sp.sell_beyond_community AS sp_sell_beyond_community
    FROM public.seller_profiles sp
    LEFT JOIN public.societies s ON s.id = sp.society_id AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    WHERE sp.verification_status = 'approved'
      AND sp.is_available = true
      AND COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
      AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
      AND COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
      AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
  )
  SELECT
    ns.id AS seller_id, ns.sp_user_id AS user_id, ns.sp_business_name AS business_name,
    ns.sp_description AS description, ns.sp_categories AS categories,
    ns.sp_primary_group AS primary_group, ns.sp_cover_image_url AS cover_image_url,
    ns.sp_profile_image_url AS profile_image_url,
    ns.sp_is_available AS is_available, ns.sp_is_featured AS is_featured,
    ns.sp_rating AS rating, ns.sp_total_reviews AS total_reviews,
    COALESCE(
      (SELECT json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'image_url', p.image_url, 'category', p.category,
        'is_veg', p.is_veg, 'action_type', p.action_type,
        'contact_phone', p.contact_phone, 'mrp', p.mrp,
        'discount_percentage', p.discount_percentage,
        'is_available', p.is_available,
        'is_bestseller', p.is_bestseller,
        'is_recommended', p.is_recommended,
        'is_urgent', p.is_urgent
      ))
      FROM public.products p
      WHERE p.seller_id = ns.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_category IS NULL OR p.category::text = _category)
        AND (_term IS NULL OR (
          p.name ILIKE _term_pattern
          OR p.description ILIKE _term_pattern
          OR p.category::text ILIKE _term_pattern
          OR p.brand ILIKE _term_pattern
          OR p.ingredients ILIKE _term_pattern
          OR EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE t ILIKE _term_pattern)
          OR EXISTS (SELECT 1 FROM unnest(p.bullet_features) bf WHERE bf ILIKE _term_pattern)
          OR (p.category::text = ANY(_matching_categories))
        ))
      ), '[]'::json
    ) AS matching_products,
    ns.computed_distance_km AS distance_km,
    ns.resolved_society_name AS society_name,
    ns.sp_availability_start AS availability_start, ns.sp_availability_end AS availability_end,
    ns.resolved_lat AS seller_latitude, ns.resolved_lng AS seller_longitude,
    ns.sp_operating_days AS operating_days
  FROM nearby_sellers ns
  WHERE ns.computed_distance_km <= LEAST(_radius_km, COALESCE(ns.sp_delivery_radius_km, _radius_km))
    AND (_exclude_society_id IS NULL OR ns.sp_society_id IS NULL OR ns.sp_society_id != _exclude_society_id)
    AND (
      ns.sp_seller_type = 'commercial'
      OR ns.sp_sell_beyond_community = true
      OR ns.sp_society_id IS NULL
      OR ns.sp_society_id = _caller_society_id
    )
    AND (
      _term IS NULL
      OR ns.sp_business_name ILIKE _term_pattern
      OR ns.sp_description ILIKE _term_pattern
      OR EXISTS (SELECT 1 FROM unnest(ns.sp_categories) sc WHERE sc::text ILIKE _term_pattern)
      OR EXISTS (SELECT 1 FROM unnest(ns.sp_categories) sc WHERE sc::text = ANY(_matching_categories))
      OR EXISTS (
        SELECT 1 FROM public.products p2
        WHERE p2.seller_id = ns.id
          AND p2.is_available = true
          AND p2.approval_status = 'approved'
          AND (
            p2.name ILIKE _term_pattern
            OR p2.description ILIKE _term_pattern
            OR p2.category::text ILIKE _term_pattern
            OR p2.brand ILIKE _term_pattern
            OR p2.ingredients ILIKE _term_pattern
            OR EXISTS (SELECT 1 FROM unnest(p2.tags) t WHERE t ILIKE _term_pattern)
            OR EXISTS (SELECT 1 FROM unnest(p2.bullet_features) bf WHERE bf ILIKE _term_pattern)
            OR (p2.category::text = ANY(_matching_categories))
          )
      )
    )
    AND (_category IS NULL OR EXISTS (
      SELECT 1 FROM public.products p3
      WHERE p3.seller_id = ns.id AND p3.is_available = true AND p3.approval_status = 'approved'
        AND p3.category::text = _category
    ))
  ORDER BY ns.computed_distance_km;
END;
$function$;
