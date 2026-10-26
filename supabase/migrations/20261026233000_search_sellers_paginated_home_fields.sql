-- Fold seller home-service / vacation / prep into search_sellers_paginated
-- so marketplace no longer needs a third seller_profiles round-trip.
-- RETURNS TABLE change requires DROP before CREATE.

DROP FUNCTION IF EXISTS public.search_sellers_paginated(double precision, double precision, double precision, integer, integer);

CREATE FUNCTION public.search_sellers_paginated(
  _lat double precision,
  _lng double precision,
  _radius_km double precision DEFAULT 50,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  seller_id uuid,
  user_id uuid,
  business_name text,
  description text,
  categories text[],
  primary_group text,
  cover_image_url text,
  profile_image_url text,
  is_available boolean,
  is_featured boolean,
  rating numeric,
  total_reviews integer,
  society_name text,
  availability_start time without time zone,
  availability_end time without time zone,
  seller_latitude double precision,
  seller_longitude double precision,
  operating_days text[],
  distance_km double precision,
  product_count bigint,
  avg_response_minutes integer,
  last_active_at timestamp with time zone,
  completed_order_count integer,
  home_service_available boolean,
  home_service_fee numeric,
  fulfillment_mode text,
  vacation_mode boolean,
  avg_preparation_time integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    sp.id,
    sp.user_id,
    sp.business_name,
    sp.description,
    sp.categories,
    sp.primary_group,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.is_available,
    sp.is_featured,
    sp.rating,
    sp.total_reviews,
    s.name,
    sp.availability_start,
    sp.availability_end,
    sp.latitude,
    sp.longitude,
    sp.operating_days,
    public.haversine_km(_lat, _lng, sp.latitude, sp.longitude) AS distance_km,
    COALESCE(pc.cnt, 0),
    sp.avg_response_minutes,
    sp.last_active_at,
    sp.completed_order_count,
    COALESCE(sp.home_service_available, false),
    sp.home_service_fee,
    sp.fulfillment_mode,
    COALESCE(sp.vacation_mode, false),
    sp.avg_preparation_time
  FROM public.seller_profiles sp
  LEFT JOIN public.societies s ON s.id = sp.society_id
  LEFT JOIN (
    SELECT p.seller_id, count(*) AS cnt
    FROM public.products p
    WHERE p.is_available = true AND p.approval_status = 'approved'
    GROUP BY p.seller_id
  ) pc ON pc.seller_id = sp.id
  WHERE public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
  ORDER BY sp.is_featured DESC, distance_km ASC
  LIMIT _limit OFFSET _offset;
$$;

GRANT EXECUTE ON FUNCTION public.search_sellers_paginated(double precision, double precision, double precision, integer, integer) TO anon, authenticated, service_role;
