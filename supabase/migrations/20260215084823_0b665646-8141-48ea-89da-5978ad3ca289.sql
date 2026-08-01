
-- Drop old search_marketplace (has different return type)
DROP FUNCTION IF EXISTS public.search_marketplace(text, uuid);

-- Recreate with correct return type (removed fulfillment_mode, delivery_note from return - those are product-level, not seller-level)
CREATE OR REPLACE FUNCTION public.search_marketplace(search_term text, user_society_id uuid DEFAULT NULL)
 RETURNS TABLE(seller_id uuid, business_name text, description text, cover_image_url text, profile_image_url text, rating numeric, total_reviews integer, categories text[], primary_group text, is_available boolean, is_featured boolean, user_id uuid, matching_products jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '10s'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    sp.id AS seller_id,
    sp.business_name,
    sp.description,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.rating,
    sp.total_reviews,
    sp.categories,
    sp.primary_group,
    sp.is_available,
    sp.is_featured,
    sp.user_id,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'image_url', p.image_url, 'category', p.category, 'is_veg', p.is_veg,
        'action_type', COALESCE(p.action_type, 'add_to_cart'),
        'contact_phone', p.contact_phone
      ))
      FROM products p
      WHERE p.seller_id = sp.id
        AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (p.name ILIKE '%' || search_term || '%' OR p.description ILIKE '%' || search_term || '%')
    ) AS matching_products
  FROM seller_profiles sp
  WHERE sp.verification_status = 'approved'
    AND (user_society_id IS NULL OR sp.society_id = user_society_id)
    AND (
      sp.business_name ILIKE '%' || search_term || '%'
      OR sp.description ILIKE '%' || search_term || '%'
      OR EXISTS (
        SELECT 1 FROM products p2
        WHERE p2.seller_id = sp.id AND p2.is_available = true AND p2.approval_status = 'approved'
          AND (p2.name ILIKE '%' || search_term || '%' OR p2.description ILIKE '%' || search_term || '%')
      )
    )
  ORDER BY sp.is_featured DESC, sp.rating DESC;
END;
$function$;

-- Drop and recreate search_nearby_sellers with action_type + contact_phone + approval_status
DROP FUNCTION IF EXISTS public.search_nearby_sellers(uuid, integer, text, text);

CREATE OR REPLACE FUNCTION public.search_nearby_sellers(_buyer_society_id uuid, _radius_km integer DEFAULT 5, _search_term text DEFAULT NULL::text, _category text DEFAULT NULL::text)
 RETURNS TABLE(seller_id uuid, business_name text, description text, cover_image_url text, profile_image_url text, rating numeric, total_reviews integer, categories text[], primary_group text, is_available boolean, is_featured boolean, availability_start time without time zone, availability_end time without time zone, user_id uuid, society_name text, distance_km numeric, matching_products jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '10s'
AS $function$
DECLARE
  _buyer_lat numeric;
  _buyer_lon numeric;
BEGIN
  SELECT latitude, longitude INTO _buyer_lat, _buyer_lon
  FROM societies WHERE id = _buyer_society_id;

  IF _buyer_lat IS NULL OR _buyer_lon IS NULL THEN
    RAISE EXCEPTION 'Buyer society has no coordinates';
  END IF;

  RETURN QUERY
  SELECT
    sp.id AS seller_id,
    sp.business_name,
    sp.description,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.rating,
    sp.total_reviews,
    sp.categories,
    sp.primary_group,
    sp.is_available,
    sp.is_featured,
    sp.availability_start,
    sp.availability_end,
    sp.user_id,
    s.name AS society_name,
    ROUND(public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude), 1) AS distance_km,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'image_url', p.image_url, 'category', p.category, 'is_veg', p.is_veg,
        'action_type', COALESCE(p.action_type, 'add_to_cart'),
        'contact_phone', p.contact_phone
      ))
      FROM products p
      WHERE p.seller_id = sp.id AND p.is_available = true
        AND p.approval_status = 'approved'
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%' OR p.description ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
    ) AS matching_products
  FROM seller_profiles sp
  JOIN societies s ON s.id = sp.society_id
  WHERE sp.verification_status = 'approved'
    AND sp.society_id != _buyer_society_id
    AND sp.sell_beyond_community = true
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude) <= sp.delivery_radius_km
    AND public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude) <= _radius_km
    AND (_search_term IS NULL OR sp.business_name ILIKE '%' || _search_term || '%' OR sp.description ILIKE '%' || _search_term || '%'
         OR EXISTS (SELECT 1 FROM products p2 WHERE p2.seller_id = sp.id AND p2.is_available = true AND p2.approval_status = 'approved' AND (p2.name ILIKE '%' || _search_term || '%' OR p2.description ILIKE '%' || _search_term || '%')))
    AND (_category IS NULL OR _category = ANY(sp.categories))
  ORDER BY distance_km ASC, sp.is_featured DESC, sp.rating DESC;
END;
$function$;
