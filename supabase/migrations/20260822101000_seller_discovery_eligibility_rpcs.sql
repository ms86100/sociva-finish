-- Patch all buyer discovery RPCs to use seller_is_discoverable_to_buyer.
-- Search, home feed, banners, and trending must not bypass credit/radius/location rules.

CREATE OR REPLACE FUNCTION public.search_products_v2(
  _query text DEFAULT '',
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _radius_km double precision DEFAULT 10,
  _buyer_society_id uuid DEFAULT NULL,
  _categories text[] DEFAULT NULL,
  _min_rating numeric DEFAULT 0,
  _is_veg boolean DEFAULT NULL,
  _min_price numeric DEFAULT NULL,
  _max_price numeric DEFAULT NULL,
  _sort_by text DEFAULT NULL,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  price numeric,
  image_url text,
  category text,
  is_veg boolean,
  is_available boolean,
  action_type text,
  description text,
  brand text,
  mrp numeric,
  discount_percentage numeric,
  seller_id uuid,
  seller_name text,
  seller_rating numeric,
  seller_total_reviews integer,
  seller_profile_image text,
  society_name text,
  is_same_society boolean,
  distance_km double precision,
  rank real,
  retrieval_mode text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH input AS (
    SELECT
      NULLIF(btrim(lower(COALESCE(_query, ''))), '') AS term,
      CASE
        WHEN NULLIF(btrim(COALESCE(_query, '')), '') IS NULL THEN NULL::tsquery
        ELSE websearch_to_tsquery('english', btrim(_query))
      END AS tsq,
      (SELECT pr.society_id FROM public.profiles pr WHERE pr.id = auth.uid()) AS buyer_society_id,
      GREATEST(COALESCE(_radius_km, 10), 0) AS radius_km,
      LEAST(GREATEST(COALESCE(_limit, 20), 1), 100) AS row_limit,
      GREATEST(COALESCE(_offset, 0), 0) AS row_offset
  ),
  eligible AS (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.price,
      p.image_url,
      p.category::text AS category,
      p.is_veg,
      p.is_available,
      p.action_type,
      p.description,
      p.brand,
      p.mrp,
      p.discount_percentage,
      p.search_vector,
      p.created_at,
      sp.id AS seller_id,
      sp.business_name AS seller_name,
      sp.rating AS seller_rating,
      sp.total_reviews AS seller_total_reviews,
      sp.profile_image_url AS seller_profile_image,
      sp.society_id AS seller_society_id,
      s.name AS resolved_society_name,
      public.haversine_km(_lat, _lng, sp.latitude, sp.longitude) AS computed_distance_km,
      i.term,
      i.tsq,
      i.buyer_society_id,
      i.radius_km,
      i.row_limit,
      i.row_offset
    FROM public.products p
    JOIN public.seller_profiles sp ON sp.id = p.seller_id
    LEFT JOIN public.societies s ON s.id = sp.society_id
    CROSS JOIN input i
    WHERE p.is_available = true
      AND p.approval_status = 'approved'
      AND (p.stock_quantity IS NULL OR p.stock_quantity > 0)
      AND public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
      AND (COALESCE(array_length(_categories, 1), 0) = 0 OR p.category::text = ANY(_categories))
      AND COALESCE(sp.rating, 0) >= COALESCE(_min_rating, 0)
      AND (_is_veg IS NULL OR p.is_veg = _is_veg)
      AND (_min_price IS NULL OR p.price >= _min_price)
      AND (_max_price IS NULL OR p.price <= _max_price)
      AND (
        i.term IS NULL
        OR lower(p.name) = i.term
        OR lower(p.name) LIKE '%' || i.term || '%'
        OR p.search_vector @@ i.tsq
      )
      AND (
        sp.seller_type = 'commercial'
        OR sp.sell_beyond_community = true
        OR sp.society_id IS NULL
        OR sp.society_id = i.buyer_society_id
      )
  ),
  scored AS (
    SELECT
      e.*,
      CASE
        WHEN e.term IS NULL THEN 0::real
        WHEN lower(e.product_name) = e.term THEN 4::real
        WHEN lower(e.product_name) LIKE e.term || '%' THEN 3::real
        WHEN lower(e.product_name) LIKE '%' || e.term || '%' THEN 2::real
        ELSE ts_rank(e.search_vector, e.tsq)
      END AS search_rank,
      CASE
        WHEN e.term IS NULL THEN 'browse'
        WHEN lower(e.product_name) = e.term THEN 'exact'
        WHEN lower(e.product_name) LIKE '%' || e.term || '%' THEN 'phrase'
        ELSE 'fts'
      END AS matched_by
    FROM eligible e
  )
  SELECT
    sc.product_id,
    sc.product_name,
    sc.price,
    sc.image_url,
    sc.category,
    sc.is_veg,
    sc.is_available,
    sc.action_type,
    sc.description,
    sc.brand,
    sc.mrp,
    sc.discount_percentage,
    sc.seller_id,
    sc.seller_name,
    sc.seller_rating,
    sc.seller_total_reviews,
    sc.seller_profile_image,
    sc.resolved_society_name,
    sc.buyer_society_id IS NOT NULL
      AND sc.seller_society_id = sc.buyer_society_id,
    sc.computed_distance_km,
    sc.search_rank,
    sc.matched_by
  FROM scored sc
  ORDER BY
    CASE WHEN _sort_by = 'price_low' THEN sc.price END ASC,
    CASE WHEN _sort_by = 'price_high' THEN sc.price END DESC,
    CASE WHEN _sort_by = 'rating' THEN sc.seller_rating END DESC NULLS LAST,
    CASE WHEN _sort_by = 'nearest' THEN sc.computed_distance_km END ASC NULLS LAST,
    CASE WHEN _sort_by IS NULL THEN sc.search_rank END DESC,
    CASE WHEN _sort_by = 'newest' THEN sc.created_at END DESC NULLS LAST,
    CASE
      WHEN _sort_by IS NULL
        AND sc.buyer_society_id IS NOT NULL
        AND sc.seller_society_id = sc.buyer_society_id
      THEN 0 ELSE 1
    END,
    CASE WHEN _sort_by IS NULL THEN sc.computed_distance_km END ASC NULLS LAST,
    sc.product_name,
    sc.product_id
  LIMIT (SELECT row_limit FROM input)
  OFFSET (SELECT row_offset FROM input);
$$;

REVOKE ALL ON FUNCTION public.search_products_v2(
  text, double precision, double precision, double precision, uuid, text[],
  numeric, boolean, numeric, numeric, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_v2(
  text, double precision, double precision, double precision, uuid, text[],
  numeric, boolean, numeric, numeric, text, integer, integer
) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.search_products_fts(
  _query text,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _radius_km double precision DEFAULT 10,
  _category text DEFAULT NULL,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  price numeric,
  image_url text,
  category text,
  is_veg boolean,
  is_available boolean,
  action_type text,
  description text,
  brand text,
  mrp numeric,
  discount_percentage numeric,
  seller_id uuid,
  seller_name text,
  seller_rating numeric,
  seller_total_reviews integer,
  seller_profile_image text,
  society_name text,
  distance_km double precision,
  rank real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tsquery tsquery;
  _has_query boolean;
BEGIN
  _has_query := (_query IS NOT NULL AND trim(_query) <> '');

  IF _has_query THEN
    BEGIN
      _tsquery := to_tsquery('english',
        array_to_string(
          array(SELECT lexeme || ':*' FROM unnest(
            string_to_array(regexp_replace(trim(_query), '\s+', ' ', 'g'), ' ')
          ) AS lexeme WHERE length(lexeme) > 0),
          ' & '
        )
      );
    EXCEPTION WHEN OTHERS THEN
      _tsquery := plainto_tsquery('english', _query);
    END;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.price,
    p.image_url,
    p.category::text AS category,
    p.is_veg,
    p.is_available,
    p.action_type,
    p.description,
    p.brand,
    p.mrp,
    p.discount_percentage,
    sp.id AS seller_id,
    sp.business_name AS seller_name,
    sp.rating AS seller_rating,
    sp.total_reviews AS seller_total_reviews,
    sp.profile_image_url AS seller_profile_image,
    s.name AS society_name,
    public.haversine_km(_lat, _lng, sp.latitude, sp.longitude) AS distance_km,
    CASE WHEN _has_query AND _tsquery IS NOT NULL
      THEN ts_rank(p.search_vector, _tsquery)
      ELSE 0.0
    END::real AS rank
  FROM public.products p
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  LEFT JOIN public.societies s ON s.id = sp.society_id
  WHERE p.is_available = true
    AND p.approval_status = 'approved'
    AND public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
    AND (
      NOT _has_query
      OR (_tsquery IS NOT NULL AND p.search_vector @@ _tsquery)
      OR p.name ILIKE '%' || trim(_query) || '%'
    )
    AND (_category IS NULL OR p.category::text = _category)
  ORDER BY rank DESC, p.is_bestseller DESC NULLS LAST, p.name
  LIMIT _limit
  OFFSET _offset;
END;
$$;

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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    sp.id, sp.user_id, sp.business_name, sp.description,
    sp.categories, sp.primary_group, sp.cover_image_url, sp.profile_image_url,
    sp.is_available, sp.is_featured, sp.rating, sp.total_reviews,
    s.name, sp.availability_start, sp.availability_end,
    sp.latitude, sp.longitude, sp.operating_days,
    public.haversine_km(_lat, _lng, sp.latitude, sp.longitude) AS distance_km,
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
  WHERE public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
  ORDER BY sp.is_featured DESC, 19 ASC
  LIMIT _limit OFFSET _offset;
$$;

CREATE OR REPLACE FUNCTION public.get_products_for_sellers(
  _seller_ids uuid[],
  _category text DEFAULT NULL,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL
)
RETURNS TABLE(
  product_id uuid,
  seller_id uuid,
  product_name text,
  price numeric,
  image_url text,
  category text,
  is_veg boolean,
  is_available boolean,
  is_bestseller boolean,
  is_recommended boolean,
  is_urgent boolean,
  action_type text,
  contact_phone text,
  mrp numeric,
  discount_percentage numeric,
  description text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.seller_id, p.name, p.price, p.image_url, p.category::text, p.is_veg, p.is_available,
         p.is_bestseller, p.is_recommended, p.is_urgent, p.action_type, p.contact_phone, p.mrp,
         p.discount_percentage, p.description
  FROM public.products p
  WHERE p.seller_id = ANY(_seller_ids)
    AND p.is_available = true
    AND p.approval_status = 'approved'
    AND (_category IS NULL OR p.category::text = _category)
    AND public.seller_is_discoverable_to_buyer(p.seller_id, _lat, _lng)
  ORDER BY p.is_bestseller DESC NULLS LAST, p.is_recommended DESC NULLS LAST, p.name
  LIMIT _limit OFFSET _offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_sellers_by_location(
  _lat double precision,
  _lng double precision,
  _radius_km numeric DEFAULT 5,
  _category text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, business_name text, description text, rating numeric, total_reviews integer,
  distance_km numeric, categories text[], profile_image_url text, cover_image_url text, society_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT sp.id, sp.business_name, sp.description, sp.rating, sp.total_reviews,
         ROUND(public.haversine_km(_lat, _lng, sp.latitude, sp.longitude)::numeric, 2),
         sp.categories, sp.profile_image_url, sp.cover_image_url, s.name
  FROM seller_profiles sp
  LEFT JOIN societies s ON s.id = sp.society_id
  WHERE public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
    AND (_category IS NULL OR _category = ANY(sp.categories))
  ORDER BY 6;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_trending_products_by_society(
  _society_id uuid,
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid, name text, description text, price numeric, image_url text, category text,
  is_veg boolean, is_available boolean, is_bestseller boolean, is_recommended boolean,
  is_urgent boolean, seller_id uuid, created_at timestamp with time zone,
  updated_at timestamp with time zone, approval_status text, seller_business_name text,
  seller_rating numeric, seller_society_id uuid, seller_verification_status text,
  seller_fulfillment_mode text, seller_delivery_note text,
  seller_availability_start time without time zone, seller_availability_end time without time zone,
  seller_operating_days text[], seller_is_available boolean,
  seller_completed_order_count integer, seller_last_active_at timestamp with time zone,
  order_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.description, p.price, p.image_url,
    p.category::text, p.is_veg, p.is_available, p.is_bestseller,
    p.is_recommended, p.is_urgent, p.seller_id, p.created_at, p.updated_at,
    p.approval_status::text,
    sp.business_name, sp.rating, sp.society_id,
    sp.verification_status::text, sp.fulfillment_mode::text,
    sp.delivery_note, sp.availability_start, sp.availability_end,
    sp.operating_days, sp.is_available,
    sp.completed_order_count, sp.last_active_at,
    COUNT(oi.id)::bigint AS order_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.society_id = _society_id
    AND o.status NOT IN ('cancelled')
    AND o.created_at > now() - interval '7 days'
    AND p.is_available = true
    AND p.approval_status = 'approved'
    AND public.seller_is_eligible_for_discovery(sp.id)
  GROUP BY p.id, p.name, p.description, p.price, p.image_url,
    p.category, p.is_veg, p.is_available, p.is_bestseller,
    p.is_recommended, p.is_urgent, p.seller_id, p.created_at, p.updated_at,
    p.approval_status,
    sp.business_name, sp.rating, sp.society_id,
    sp.verification_status, sp.fulfillment_mode,
    sp.delivery_note, sp.availability_start, sp.availability_end,
    sp.operating_days, sp.is_available,
    sp.completed_order_count, sp.last_active_at
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_banner_products(
  p_mode text,
  p_value text,
  p_society_id uuid,
  p_buyer_lat double precision DEFAULT NULL,
  p_buyer_lng double precision DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_banner_id uuid DEFAULT NULL
)
RETURNS TABLE(
  id uuid, name text, price numeric, mrp numeric, image_url text, category text,
  is_veg boolean, is_available boolean, is_bestseller boolean, stock_quantity integer,
  low_stock_threshold integer, seller_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _society_lat double precision;
  _society_lng double precision;
  _lat double precision;
  _lng double precision;
BEGIN
  IF p_society_id IS NOT NULL THEN
    SELECT s.latitude, s.longitude
    INTO _society_lat, _society_lng
    FROM public.societies s
    WHERE s.id = p_society_id;
  END IF;

  _lat := COALESCE(p_buyer_lat, _society_lat);
  _lng := COALESCE(p_buyer_lng, _society_lng);

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
    AND public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
    AND (
      p_society_id IS NULL
      OR sp.society_id = p_society_id
      OR (
        sp.society_id IS DISTINCT FROM p_society_id
        AND (sp.society_id IS NULL OR sp.sell_beyond_community = true)
      )
    )
    AND (
      p_banner_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.festival_seller_participation fsp WHERE fsp.banner_id = p_banner_id)
      OR EXISTS (SELECT 1 FROM public.festival_seller_participation fsp WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = true)
    )
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
$$;

DROP FUNCTION IF EXISTS public.resolve_banner_products(text, text, uuid, double precision, double precision, integer);

CREATE OR REPLACE FUNCTION public.resolve_banner_section_products(
  p_banner_id uuid,
  p_society_id uuid DEFAULT NULL,
  p_buyer_lat double precision DEFAULT NULL,
  p_buyer_lng double precision DEFAULT NULL,
  p_limit_per_section integer DEFAULT 20
)
RETURNS TABLE(
  section_id uuid, product_id uuid, product_name text, product_price numeric, product_mrp numeric,
  product_image_url text, product_category text, product_is_veg boolean, product_is_available boolean,
  product_is_bestseller boolean, product_stock_quantity integer, product_low_stock_threshold integer,
  product_seller_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _society_lat double precision;
  _society_lng double precision;
  _lat double precision;
  _lng double precision;
BEGIN
  IF p_society_id IS NOT NULL THEN
    SELECT s.latitude, s.longitude INTO _society_lat, _society_lng
    FROM public.societies s WHERE s.id = p_society_id;
  END IF;
  _lat := COALESCE(p_buyer_lat, _society_lat);
  _lng := COALESCE(p_buyer_lng, _society_lng);

  RETURN QUERY
  SELECT
    ranked.section_id,
    ranked.id,
    ranked.name,
    ranked.price,
    ranked.mrp,
    ranked.image_url,
    ranked.category,
    ranked.is_veg,
    ranked.is_available,
    ranked.is_bestseller,
    ranked.stock_quantity,
    ranked.low_stock_threshold,
    ranked.seller_id
  FROM (
    SELECT
      bs.id AS section_id,
      p.id,
      p.name,
      p.price,
      p.mrp,
      p.image_url,
      p.category,
      p.is_veg,
      p.is_available,
      p.is_bestseller,
      p.stock_quantity,
      p.low_stock_threshold,
      p.seller_id,
      ROW_NUMBER() OVER (PARTITION BY bs.id ORDER BY p.is_bestseller DESC, p.price ASC) AS rn
    FROM banner_sections bs
    JOIN products p ON (
      (bs.product_source_type = 'category' AND p.category = bs.product_source_value)
      OR (bs.product_source_type = 'search' AND p.name ILIKE '%' || bs.product_source_value || '%')
      OR (bs.product_source_type = 'manual' AND p.id IN (
        SELECT bsp.product_id FROM banner_section_products bsp WHERE bsp.section_id = bs.id
      ))
    )
    JOIN seller_profiles sp ON sp.id = p.seller_id
    WHERE bs.banner_id = p_banner_id
      AND p.is_available = true
      AND p.approval_status = 'approved'
      AND COALESCE(p.stock_quantity, 0) > 0
      AND public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
      AND EXISTS (
        SELECT 1 FROM festival_seller_participation fsp
        WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = true
      )
      AND (
        p_society_id IS NULL
        OR sp.society_id = p_society_id
        OR sp.sell_beyond_community = true
      )
  ) ranked
  WHERE ranked.rn <= p_limit_per_section
  ORDER BY ranked.section_id, ranked.rn;
END;
$$;
