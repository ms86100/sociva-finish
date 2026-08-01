CREATE INDEX IF NOT EXISTS idx_chat_messages_order_id
  ON public.chat_messages (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_receiver_read
  ON public.chat_messages (receiver_id, read_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_listings_product
  ON public.service_listings (product_id);

CREATE INDEX IF NOT EXISTS idx_subcategories_config
  ON public.subcategories (category_config_id);

CREATE INDEX IF NOT EXISTS idx_system_settings_key
  ON public.system_settings (key);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon
  ON public.coupon_redemptions (coupon_id);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_order
  ON public.coupon_redemptions (order_id);

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_order
  ON public.delivery_assignments (order_id);

CREATE INDEX IF NOT EXISTS idx_delivery_assignments_partner
  ON public.delivery_assignments (partner_id);

DROP INDEX IF EXISTS idx_products_seller_avail;

CREATE OR REPLACE FUNCTION public.search_sellers_paginated(
  _lat double precision,
  _lng double precision,
  _radius_km double precision DEFAULT 50,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  seller_id uuid, user_id uuid, business_name text, description text,
  categories text[], primary_group text, cover_image_url text, profile_image_url text,
  is_available boolean, is_featured boolean, rating numeric, total_reviews integer,
  society_name text, availability_start time without time zone, availability_end time without time zone,
  seller_latitude double precision, seller_longitude double precision, operating_days text[],
  distance_km double precision, product_count bigint, avg_response_minutes integer,
  last_active_at timestamp with time zone, completed_order_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    sp.id, sp.user_id, sp.business_name, sp.description,
    sp.categories, sp.primary_group, sp.cover_image_url, sp.profile_image_url,
    sp.is_available, sp.is_featured, sp.rating, sp.total_reviews,
    s.name, sp.availability_start, sp.availability_end,
    sp.latitude, sp.longitude, sp.operating_days,
    (6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians(_lng))
      + sin(radians(_lat)) * sin(radians(sp.latitude))
    )))) AS distance_km,
    COALESCE(pc.cnt, 0),
    sp.avg_response_minutes, sp.last_active_at, sp.completed_order_count
  FROM public.seller_profiles sp
  LEFT JOIN public.societies s ON s.id = sp.society_id
  LEFT JOIN (
    SELECT p.seller_id, count(*) AS cnt
    FROM public.products p
    WHERE p.is_available = true AND p.approval_status = 'approved'
    GROUP BY p.seller_id
  ) pc ON pc.seller_id = sp.id
  WHERE
    sp.verification_status = 'approved'
    AND sp.latitude IS NOT NULL AND sp.longitude IS NOT NULL
    AND sp.latitude BETWEEN (_lat - _radius_km / 111.0) AND (_lat + _radius_km / 111.0)
    AND sp.longitude BETWEEN (_lng - _radius_km / (111.0 * cos(radians(_lat)))) AND (_lng + _radius_km / (111.0 * cos(radians(_lat))))
    AND (6371 * acos(LEAST(1.0, GREATEST(-1.0,
      cos(radians(_lat)) * cos(radians(sp.latitude)) * cos(radians(sp.longitude) - radians(_lng))
      + sin(radians(_lat)) * sin(radians(sp.latitude))
    )))) <= _radius_km
  ORDER BY sp.is_featured DESC, distance_km ASC
  LIMIT _limit OFFSET _offset;
$function$;

ANALYZE public.seller_profiles;
ANALYZE public.products;
ANALYZE public.orders;
ANALYZE public.order_items;
ANALYZE public.profiles;
ANALYZE public.user_roles;
ANALYZE public.chat_messages;
ANALYZE public.category_status_flows;
ANALYZE public.parent_groups;