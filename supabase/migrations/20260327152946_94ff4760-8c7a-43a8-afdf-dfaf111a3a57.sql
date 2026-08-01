
-- 1. Add tsvector column for full-text search
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Populate existing rows
UPDATE public.products SET search_vector =
  setweight(to_tsvector('english', COALESCE(name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(brand, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(description, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(ingredients, '')), 'D');

-- 3. GIN index for fast full-text lookups
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON public.products USING GIN (search_vector);

-- 4. Trigger to auto-update on insert/update
CREATE OR REPLACE FUNCTION public.products_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.brand, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.ingredients, '')), 'D');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_products_search_vector
BEFORE INSERT OR UPDATE OF name, brand, description, ingredients ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_search_vector_update();

-- 5. FTS search RPC: replaces ILIKE pattern matching
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
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tsquery tsquery;
  _box_delta double precision;
BEGIN
  -- Build tsquery from input (prefix matching for autocomplete)
  _tsquery := websearch_to_tsquery('english', _query);
  IF _tsquery IS NULL OR _tsquery::text = '' THEN
    -- Fallback: try plainto_tsquery
    _tsquery := plainto_tsquery('english', _query);
  END IF;
  IF _tsquery IS NULL OR _tsquery::text = '' THEN
    RETURN;
  END IF;

  _box_delta := _radius_km * 0.009;

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
    CASE WHEN _lat IS NOT NULL AND _lng IS NOT NULL THEN
      public.haversine_km(_lat, _lng,
        COALESCE(sp.latitude, s.latitude::double precision),
        COALESCE(sp.longitude, s.longitude::double precision))
    ELSE NULL END AS distance_km,
    ts_rank(p.search_vector, _tsquery) AS rank
  FROM public.products p
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  LEFT JOIN public.societies s ON s.id = sp.society_id
  WHERE p.is_available = true
    AND p.approval_status = 'approved'
    AND sp.verification_status = 'approved'
    AND sp.is_available = true
    AND p.search_vector @@ _tsquery
    AND (_category IS NULL OR p.category::text = _category)
    AND (
      _lat IS NULL OR _lng IS NULL
      OR (
        COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
        AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
      )
    )
  ORDER BY rank DESC, p.is_bestseller DESC NULLS LAST, p.name
  LIMIT _limit
  OFFSET _offset;
END;
$$;

-- 6. Paginated sellers RPC: returns sellers with product_count, NO embedded products
CREATE OR REPLACE FUNCTION public.search_sellers_paginated(
  _lat double precision,
  _lng double precision,
  _radius_km double precision DEFAULT 10,
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
  availability_start text,
  availability_end text,
  seller_latitude double precision,
  seller_longitude double precision,
  operating_days text[],
  distance_km double precision,
  product_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _box_delta double precision;
BEGIN
  IF _lat IS NULL OR _lng IS NULL THEN RETURN; END IF;
  _box_delta := _radius_km * 0.009;

  RETURN QUERY
  SELECT
    sp.id AS seller_id,
    sp.user_id,
    sp.business_name,
    sp.description,
    ARRAY(SELECT unnest(sp.categories)::text) AS categories,
    sp.primary_group::text,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.is_available,
    sp.is_featured,
    sp.rating,
    sp.total_reviews,
    s.name AS society_name,
    sp.availability_start::text,
    sp.availability_end::text,
    COALESCE(sp.latitude, s.latitude::double precision) AS seller_latitude,
    COALESCE(sp.longitude, s.longitude::double precision) AS seller_longitude,
    sp.operating_days::text[] AS operating_days,
    public.haversine_km(_lat, _lng,
      COALESCE(sp.latitude, s.latitude::double precision),
      COALESCE(sp.longitude, s.longitude::double precision)
    ) AS distance_km,
    (SELECT COUNT(*) FROM public.products p
     WHERE p.seller_id = sp.id AND p.is_available = true AND p.approval_status = 'approved'
    ) AS product_count
  FROM public.seller_profiles sp
  LEFT JOIN public.societies s ON s.id = sp.society_id AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
  WHERE sp.verification_status = 'approved'
    AND sp.is_available = true
    AND COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
    AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
    AND COALESCE(sp.latitude, s.latitude::double precision) BETWEEN (_lat - _box_delta) AND (_lat + _box_delta)
    AND COALESCE(sp.longitude, s.longitude::double precision) BETWEEN (_lng - _box_delta) AND (_lng + _box_delta)
  ORDER BY sp.is_featured DESC, distance_km ASC
  LIMIT _limit
  OFFSET _offset;
END;
$$;

-- 7. Get products for specific sellers, paginated, optionally filtered by category
CREATE OR REPLACE FUNCTION public.get_products_for_sellers(
  _seller_ids uuid[],
  _category text DEFAULT NULL,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0
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
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.seller_id,
    p.name AS product_name,
    p.price,
    p.image_url,
    p.category::text AS category,
    p.is_veg,
    p.is_available,
    p.is_bestseller,
    p.is_recommended,
    p.is_urgent,
    p.action_type,
    p.contact_phone,
    p.mrp,
    p.discount_percentage,
    p.description
  FROM public.products p
  WHERE p.seller_id = ANY(_seller_ids)
    AND p.is_available = true
    AND p.approval_status = 'approved'
    AND (_category IS NULL OR p.category::text = _category)
  ORDER BY p.is_bestseller DESC NULLS LAST, p.is_recommended DESC NULLS LAST, p.name
  LIMIT _limit
  OFFSET _offset;
END;
$$;
