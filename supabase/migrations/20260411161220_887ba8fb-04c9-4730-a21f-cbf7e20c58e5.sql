
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
  last_active_at timestamptz,
  completed_order_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sp.id AS seller_id,
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
    s.name AS society_name,
    sp.availability_start,
    sp.availability_end,
    sp.latitude AS seller_latitude,
    sp.longitude AS seller_longitude,
    sp.operating_days,
    (
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_lat)) * cos(radians(sp.latitude))
          * cos(radians(sp.longitude) - radians(_lng))
          + sin(radians(_lat)) * sin(radians(sp.latitude))
        ))
      )
    ) AS distance_km,
    (SELECT count(*) FROM public.products p WHERE p.seller_id = sp.id AND p.is_available = true) AS product_count,
    sp.avg_response_minutes,
    sp.last_active_at,
    sp.completed_order_count
  FROM public.seller_profiles sp
  LEFT JOIN public.societies s ON s.id = sp.society_id
  WHERE
    sp.verification_status = 'approved'
    AND sp.latitude IS NOT NULL
    AND sp.longitude IS NOT NULL
    AND (
      6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(_lat)) * cos(radians(sp.latitude))
          * cos(radians(sp.longitude) - radians(_lng))
          + sin(radians(_lat)) * sin(radians(sp.latitude))
        ))
      )
    ) <= _radius_km
  ORDER BY sp.is_featured DESC, distance_km ASC
  LIMIT _limit
  OFFSET _offset;
$$;
