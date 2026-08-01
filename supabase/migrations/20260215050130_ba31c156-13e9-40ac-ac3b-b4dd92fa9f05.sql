
-- Add cross-society commerce columns to seller_profiles
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS sell_beyond_community boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_radius_km integer NOT NULL DEFAULT 5;

-- Add cross-society browsing columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS browse_beyond_community boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS search_radius_km integer NOT NULL DEFAULT 5;

-- Create haversine distance function
CREATE OR REPLACE FUNCTION public.haversine_km(
  lat1 numeric, lon1 numeric,
  lat2 numeric, lon2 numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 6371 * 2 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2))^2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians((lon2 - lon1) / 2))^2
  ))
$$;

-- Create function to search sellers within a radius from a society
CREATE OR REPLACE FUNCTION public.search_nearby_sellers(
  _buyer_society_id uuid,
  _radius_km integer DEFAULT 5,
  _search_term text DEFAULT NULL,
  _category text DEFAULT NULL
)
RETURNS TABLE(
  seller_id uuid,
  business_name text,
  description text,
  cover_image_url text,
  profile_image_url text,
  rating numeric,
  total_reviews integer,
  categories text[],
  primary_group text,
  is_available boolean,
  is_featured boolean,
  availability_start time,
  availability_end time,
  user_id uuid,
  society_name text,
  distance_km numeric,
  matching_products jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $$
DECLARE
  _buyer_lat numeric;
  _buyer_lon numeric;
BEGIN
  -- Get buyer society coordinates
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
        'image_url', p.image_url, 'category', p.category, 'is_veg', p.is_veg
      ))
      FROM products p
      WHERE p.seller_id = sp.id AND p.is_available = true
        AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%' OR p.description ILIKE '%' || _search_term || '%')
        AND (_category IS NULL OR p.category::text = _category)
    ) AS matching_products
  FROM seller_profiles sp
  JOIN societies s ON s.id = sp.society_id
  WHERE sp.verification_status = 'approved'
    AND sp.society_id != _buyer_society_id  -- exclude own society (already shown normally)
    AND sp.sell_beyond_community = true     -- seller opted in
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    -- seller's delivery radius covers the buyer's society
    AND public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude) <= sp.delivery_radius_km
    -- buyer's search radius covers the seller's society
    AND public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude) <= _radius_km
    AND (_search_term IS NULL OR sp.business_name ILIKE '%' || _search_term || '%' OR sp.description ILIKE '%' || _search_term || '%'
         OR EXISTS (SELECT 1 FROM products p2 WHERE p2.seller_id = sp.id AND p2.is_available = true AND (p2.name ILIKE '%' || _search_term || '%' OR p2.description ILIKE '%' || _search_term || '%')))
    AND (_category IS NULL OR _category = ANY(sp.categories))
  ORDER BY distance_km ASC, sp.is_featured DESC, sp.rating DESC;
END;
$$;
