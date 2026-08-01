
-- Drop and recreate search_nearby_sellers with optimized logic
DROP FUNCTION IF EXISTS public.search_nearby_sellers(uuid, numeric, text, text);

CREATE FUNCTION public.search_nearby_sellers(
  _buyer_society_id uuid,
  _radius_km numeric,
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
  availability_start time without time zone,
  availability_end time without time zone,
  user_id uuid,
  society_name text,
  distance_km numeric,
  matching_products jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _buyer_lat numeric;
  _buyer_lon numeric;
  _lat_offset numeric;
  _lon_offset numeric;
BEGIN
  SELECT latitude, longitude INTO _buyer_lat, _buyer_lon
  FROM societies WHERE id = _buyer_society_id;

  IF _buyer_lat IS NULL OR _buyer_lon IS NULL THEN
    RAISE EXCEPTION 'Buyer society has no coordinates';
  END IF;

  _lat_offset := _radius_km / 111.0;
  _lon_offset := _radius_km / (111.0 * cos(radians(_buyer_lat)));

  RETURN QUERY
  WITH product_agg AS (
    SELECT
      p.seller_id AS sid,
      jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'price', p.price,
        'image_url', p.image_url, 'category', p.category, 'is_veg', p.is_veg
      )) AS products_json
    FROM products p
    WHERE p.is_available = true
      AND p.approval_status = 'approved'
      AND (_search_term IS NULL OR p.name ILIKE '%' || _search_term || '%')
      AND (_category IS NULL OR p.category::text = _category)
    GROUP BY p.seller_id
  )
  SELECT
    sp.id, sp.business_name, sp.description,
    sp.cover_image_url, sp.profile_image_url,
    sp.rating, sp.total_reviews, sp.categories, sp.primary_group,
    sp.is_available, sp.is_featured,
    sp.availability_start, sp.availability_end, sp.user_id,
    s.name,
    ROUND(public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude), 1) AS dist,
    COALESCE(pa.products_json, '[]'::jsonb)
  FROM seller_profiles sp
  JOIN societies s ON s.id = sp.society_id
  LEFT JOIN product_agg pa ON pa.sid = sp.id
  WHERE sp.verification_status = 'approved'
    AND sp.society_id != _buyer_society_id
    AND sp.sell_beyond_community = true
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND s.latitude BETWEEN (_buyer_lat - _lat_offset) AND (_buyer_lat + _lat_offset)
    AND s.longitude BETWEEN (_buyer_lon - _lon_offset) AND (_buyer_lon + _lon_offset)
    AND public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude) <= COALESCE(sp.delivery_radius_km, 5)
    AND public.haversine_km(_buyer_lat, _buyer_lon, s.latitude, s.longitude) <= _radius_km
    AND (_search_term IS NULL OR sp.business_name ILIKE '%' || _search_term || '%' OR pa.sid IS NOT NULL)
    AND (_category IS NULL OR _category = ANY(sp.categories))
  ORDER BY dist ASC, sp.is_featured DESC, sp.rating DESC;
END;
$$;

-- Drop 13 duplicate indexes (non-concurrent, safe for small tables)
DROP INDEX IF EXISTS idx_user_roles_user_role;
DROP INDEX IF EXISTS idx_seller_coords;
DROP INDEX IF EXISTS idx_societies_slug;
DROP INDEX IF EXISTS idx_system_settings_key;
DROP INDEX IF EXISTS idx_payment_records_order;
DROP INDEX IF EXISTS idx_parent_groups_slug;
DROP INDEX IF EXISTS idx_products_seller_id;
DROP INDEX IF EXISTS idx_bulletin_posts_society;
DROP INDEX IF EXISTS idx_notifications_user_read_created;
DROP INDEX IF EXISTS idx_trigger_errors_created;
DROP INDEX IF EXISTS idx_service_availability_seller;
DROP INDEX IF EXISTS idx_worker_attendance_worker_date;
DROP INDEX IF EXISTS idx_orders_booking_idempotency;

-- Refresh planner stats
ANALYZE coupon_redemptions, delivery_assignments, service_listings,
  delivery_addresses, payment_records, reviews, featured_items,
  service_availability_schedules, subcategories;
