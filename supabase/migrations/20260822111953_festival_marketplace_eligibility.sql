-- Festival Marketplace: auto-eligible sellers, product exclusions,
-- inventory preview, seller match list, and richer product resolution.

-- 1. Product-level opt-out (seller can uncheck one SKU without leaving the festival)
CREATE TABLE IF NOT EXISTS public.festival_product_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banner_id uuid NOT NULL REFERENCES public.featured_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (banner_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_festival_product_exclusions_banner
  ON public.festival_product_exclusions(banner_id);
CREATE INDEX IF NOT EXISTS idx_festival_product_exclusions_seller
  ON public.festival_product_exclusions(seller_id);

ALTER TABLE public.festival_product_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_read_own_festival_exclusions" ON public.festival_product_exclusions;
CREATE POLICY "seller_read_own_festival_exclusions"
  ON public.festival_product_exclusions FOR SELECT TO authenticated
  USING (
    seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "seller_insert_own_festival_exclusions" ON public.festival_product_exclusions;
CREATE POLICY "seller_insert_own_festival_exclusions"
  ON public.festival_product_exclusions FOR INSERT TO authenticated
  WITH CHECK (
    seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_id AND p.seller_id = seller_id
    )
  );

DROP POLICY IF EXISTS "seller_delete_own_festival_exclusions" ON public.festival_product_exclusions;
CREATE POLICY "seller_delete_own_festival_exclusions"
  ON public.festival_product_exclusions FOR DELETE TO authenticated
  USING (seller_id IN (SELECT id FROM public.seller_profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "admins_manage_festival_exclusions" ON public.festival_product_exclusions;
CREATE POLICY "admins_manage_festival_exclusions"
  ON public.festival_product_exclusions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Shared matching helper
CREATE OR REPLACE FUNCTION public.festival_product_matches_rule(
  p_category text,
  p_name text,
  p_search_vector tsvector,
  p_product_id uuid,
  p_source_type text,
  p_source_value text,
  p_section_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE COALESCE(p_source_type, 'category')
    WHEN 'category' THEN p_category IS NOT DISTINCT FROM p_source_value
    WHEN 'search' THEN (
      COALESCE(p_source_value, '') <> ''
      AND (
        (p_search_vector IS NOT NULL AND p_search_vector @@ plainto_tsquery('english', p_source_value))
        OR p_name ILIKE '%' || p_source_value || '%'
      )
    )
    WHEN 'manual' THEN (
      p_section_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.banner_section_products bsp
        WHERE bsp.section_id = p_section_id AND bsp.product_id = p_product_id
      )
    )
    ELSE false
  END;
$$;

-- Drop old signatures before widening return types
DROP FUNCTION IF EXISTS public.resolve_banner_products(text, text, uuid, double precision, double precision, integer);
DROP FUNCTION IF EXISTS public.resolve_banner_products(text, text, uuid, double precision, double precision, integer, uuid);
DROP FUNCTION IF EXISTS public.resolve_banner_section_products(uuid, uuid, double precision, double precision, integer);

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
  low_stock_threshold integer, seller_id uuid,
  seller_name text, seller_rating numeric, seller_reviews integer, seller_verified boolean,
  delivery_time_text text, discount_percentage numeric
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
    p.stock_quantity, p.low_stock_threshold, p.seller_id,
    sp.business_name,
    sp.rating,
    COALESCE(sp.total_reviews, 0),
    COALESCE(sp.verification_status = 'approved', false),
    p.delivery_time_text,
    p.discount_percentage
  FROM public.products p
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE
    p.is_available = true
    AND p.approval_status = 'approved'
    AND COALESCE(p.stock_quantity, 0) > 0
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
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.festival_seller_participation fsp
          WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.festival_product_exclusions fpe
          WHERE fpe.banner_id = p_banner_id AND fpe.product_id = p.id
        )
      )
    )
    AND (
      CASE p_mode
        WHEN 'category' THEN p.category::text = p_value
        WHEN 'search' THEN public.festival_product_matches_rule(
          p.category::text, p.name, p.search_vector, p.id, 'search', p_value, NULL
        )
        WHEN 'popular' THEN p.is_bestseller = true
        ELSE true
      END
    )
  ORDER BY
    (COALESCE(p.stock_quantity, 0) > 0)::int DESC,
    p.is_bestseller DESC,
    p.is_recommended DESC,
    p.price ASC
  LIMIT p_limit;
END;
$$;

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
  product_seller_id uuid,
  seller_name text, seller_rating numeric, seller_reviews integer, seller_verified boolean,
  delivery_time_text text, discount_percentage numeric
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
  _fallback text;
BEGIN
  IF p_society_id IS NOT NULL THEN
    SELECT s.latitude, s.longitude INTO _society_lat, _society_lng
    FROM public.societies s WHERE s.id = p_society_id;
  END IF;
  _lat := COALESCE(p_buyer_lat, _society_lat);
  _lng := COALESCE(p_buyer_lng, _society_lng);

  SELECT COALESCE(fi.fallback_mode, 'hide') INTO _fallback
  FROM public.featured_items fi
  WHERE fi.id = p_banner_id;

  RETURN QUERY
  WITH matched AS (
    SELECT
      bs.id AS section_id,
      p.id,
      p.name,
      p.price,
      p.mrp,
      p.image_url,
      p.category::text AS category,
      p.is_veg,
      p.is_available,
      p.is_bestseller,
      p.stock_quantity,
      p.low_stock_threshold,
      p.seller_id,
      sp.business_name,
      sp.rating,
      COALESCE(sp.total_reviews, 0) AS total_reviews,
      COALESCE(sp.verification_status = 'approved', false) AS seller_verified,
      p.delivery_time_text,
      p.discount_percentage,
      ROW_NUMBER() OVER (PARTITION BY bs.id ORDER BY p.is_bestseller DESC, p.price ASC) AS rn
    FROM public.banner_sections bs
    JOIN public.products p ON public.festival_product_matches_rule(
      p.category::text, p.name, p.search_vector, p.id,
      bs.product_source_type, bs.product_source_value, bs.id
    )
    JOIN public.seller_profiles sp ON sp.id = p.seller_id
    WHERE bs.banner_id = p_banner_id
      AND p.is_available = true
      AND p.approval_status = 'approved'
      AND COALESCE(p.stock_quantity, 0) > 0
      AND public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
      AND NOT EXISTS (
        SELECT 1 FROM public.festival_seller_participation fsp
        WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.festival_product_exclusions fpe
        WHERE fpe.banner_id = p_banner_id AND fpe.product_id = p.id
      )
      AND (
        p_society_id IS NULL
        OR sp.society_id = p_society_id
        OR sp.sell_beyond_community = true
      )
  ),
  ranked AS (
    SELECT * FROM matched WHERE rn <= GREATEST(COALESCE(p_limit_per_section, 20), 1)
  ),
  empty_sections AS (
    SELECT bs.id
    FROM public.banner_sections bs
    WHERE bs.banner_id = p_banner_id
      AND COALESCE(_fallback, 'hide') = 'popular'
      AND NOT EXISTS (SELECT 1 FROM ranked r WHERE r.section_id = bs.id)
  ),
  popular_fill AS (
    SELECT
      es.id AS section_id,
      p.id,
      p.name,
      p.price,
      p.mrp,
      p.image_url,
      p.category::text AS category,
      p.is_veg,
      p.is_available,
      p.is_bestseller,
      p.stock_quantity,
      p.low_stock_threshold,
      p.seller_id,
      sp.business_name,
      sp.rating,
      COALESCE(sp.total_reviews, 0) AS total_reviews,
      COALESCE(sp.verification_status = 'approved', false) AS seller_verified,
      p.delivery_time_text,
      p.discount_percentage,
      ROW_NUMBER() OVER (PARTITION BY es.id ORDER BY p.is_bestseller DESC, p.price ASC) AS rn
    FROM empty_sections es
    CROSS JOIN public.products p
    JOIN public.seller_profiles sp ON sp.id = p.seller_id
    WHERE p.is_available = true
      AND p.approval_status = 'approved'
      AND COALESCE(p.stock_quantity, 0) > 0
      AND p.is_bestseller = true
      AND public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng)
      AND NOT EXISTS (
        SELECT 1 FROM public.festival_seller_participation fsp
        WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = false
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.festival_product_exclusions fpe
        WHERE fpe.banner_id = p_banner_id AND fpe.product_id = p.id
      )
      AND (
        p_society_id IS NULL
        OR sp.society_id = p_society_id
        OR sp.sell_beyond_community = true
      )
  )
  SELECT
    r.section_id, r.id, r.name, r.price, r.mrp, r.image_url, r.category,
    r.is_veg, r.is_available, r.is_bestseller, r.stock_quantity, r.low_stock_threshold,
    r.seller_id, r.business_name, r.rating, r.total_reviews, r.seller_verified,
    r.delivery_time_text, r.discount_percentage
  FROM ranked r
  UNION ALL
  SELECT
    pf.section_id, pf.id, pf.name, pf.price, pf.mrp, pf.image_url, pf.category,
    pf.is_veg, pf.is_available, pf.is_bestseller, pf.stock_quantity, pf.low_stock_threshold,
    pf.seller_id, pf.business_name, pf.rating, pf.total_reviews, pf.seller_verified,
    pf.delivery_time_text, pf.discount_percentage
  FROM popular_fill pf
  WHERE pf.rn <= GREATEST(COALESCE(p_limit_per_section, 20), 1)
  ORDER BY 1, 10 DESC, 4 ASC;
END;
$$;

-- Admin live inventory counts (works on draft section JSON, no banner required)
CREATE OR REPLACE FUNCTION public.preview_festival_section_inventory(
  p_sections jsonb,
  p_society_ids uuid[] DEFAULT NULL,
  p_banner_id uuid DEFAULT NULL
)
RETURNS TABLE(
  section_index integer,
  source_type text,
  source_value text,
  product_count bigint,
  seller_count bigint,
  society_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _elem jsonb;
  _idx integer := 0;
  _type text;
  _value text;
BEGIN
  IF p_sections IS NULL OR jsonb_typeof(p_sections) <> 'array' THEN
    RETURN;
  END IF;

  FOR _elem IN SELECT * FROM jsonb_array_elements(p_sections)
  LOOP
    _type := COALESCE(_elem->>'source_type', _elem->>'product_source_type', 'category');
    _value := COALESCE(_elem->>'source_value', _elem->>'product_source_value');

    RETURN QUERY
    SELECT
      _idx AS section_index,
      _type AS source_type,
      _value AS source_value,
      COUNT(DISTINCT p.id)::bigint AS product_count,
      COUNT(DISTINCT p.seller_id)::bigint AS seller_count,
      COUNT(DISTINCT sp.society_id)::bigint AS society_count
    FROM public.products p
    JOIN public.seller_profiles sp ON sp.id = p.seller_id
    WHERE COALESCE(_value, '') <> ''
      AND p.is_available = true
      AND p.approval_status = 'approved'
      AND COALESCE(p.stock_quantity, 0) > 0
      AND COALESCE(sp.verification_status, '') = 'approved'
      AND COALESCE(sp.is_available, true) = true
      AND public.festival_product_matches_rule(
        p.category::text, p.name, p.search_vector, p.id, _type, _value, NULL
      )
      AND (
        p_society_ids IS NULL
        OR cardinality(p_society_ids) = 0
        OR sp.society_id = ANY(p_society_ids)
        OR sp.sell_beyond_community = true
      )
      AND (
        p_banner_id IS NULL
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.festival_seller_participation fsp
            WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = false
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.festival_product_exclusions fpe
            WHERE fpe.banner_id = p_banner_id AND fpe.product_id = p.id
          )
        )
      );

    _idx := _idx + 1;
  END LOOP;
END;
$$;

-- Seller "your products matched" list
CREATE OR REPLACE FUNCTION public.festival_seller_matches(
  p_banner_id uuid,
  p_seller_id uuid
)
RETURNS TABLE(
  section_id uuid,
  section_title text,
  product_id uuid,
  product_name text,
  product_image_url text,
  product_price numeric,
  product_mrp numeric,
  is_excluded boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.seller_profiles sp
       WHERE sp.id = p_seller_id AND sp.user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  SELECT
    bs.id AS section_id,
    bs.title AS section_title,
    p.id AS product_id,
    p.name AS product_name,
    p.image_url AS product_image_url,
    p.price AS product_price,
    p.mrp AS product_mrp,
    EXISTS (
      SELECT 1 FROM public.festival_product_exclusions fpe
      WHERE fpe.banner_id = p_banner_id AND fpe.product_id = p.id
    ) AS is_excluded
  FROM public.banner_sections bs
  JOIN public.products p ON public.festival_product_matches_rule(
    p.category::text, p.name, p.search_vector, p.id,
    bs.product_source_type, bs.product_source_value, bs.id
  )
  WHERE bs.banner_id = p_banner_id
    AND p.seller_id = p_seller_id
    AND p.approval_status = 'approved'
  ORDER BY bs.display_order, p.name;
END;
$$;

-- Notify eligible sellers when a festival is published
CREATE OR REPLACE FUNCTION public.notify_eligible_sellers_festival_published(
  p_banner_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _title text;
  _inserted integer := 0;
  _society_ids uuid[];
BEGIN
  IF auth.uid() IS NOT NULL
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT fi.title, fi.target_society_ids
  INTO _title, _society_ids
  FROM public.featured_items fi
  WHERE fi.id = p_banner_id AND fi.banner_type = 'festival';

  IF _title IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notification_queue (
    user_id, title, body, type, reference_path, payload, dedupe_key
  )
  SELECT DISTINCT
    sp.user_id,
    COALESCE(_title, 'Festival') || ' is live in your community',
    'We found products in your catalogue that customers may be looking for. Review your festival participation.',
    'festival_live',
    '/seller',
    jsonb_build_object(
      'type', 'festival_live',
      'banner_id', p_banner_id,
      'target_role', 'seller'
    ),
    'festival-live-' || p_banner_id::text || '-' || sp.user_id::text
  FROM public.banner_sections bs
  JOIN public.products p ON public.festival_product_matches_rule(
    p.category::text, p.name, p.search_vector, p.id,
    bs.product_source_type, bs.product_source_value, bs.id
  )
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE bs.banner_id = p_banner_id
    AND p.is_available = true
    AND p.approval_status = 'approved'
    AND COALESCE(p.stock_quantity, 0) > 0
    AND COALESCE(sp.verification_status, '') = 'approved'
    AND (
      _society_ids IS NULL
      OR cardinality(_society_ids) = 0
      OR sp.society_id = ANY(_society_ids)
      OR sp.sell_beyond_community = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.festival_seller_participation fsp
      WHERE fsp.banner_id = p_banner_id AND fsp.seller_id = sp.id AND fsp.opted_in = false
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_queue nq
      WHERE nq.dedupe_key = 'festival-live-' || p_banner_id::text || '-' || sp.user_id::text
    );

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN COALESCE(_inserted, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.festival_product_matches_rule(text, text, tsvector, uuid, text, text, uuid)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_banner_products(text, text, uuid, double precision, double precision, integer, uuid)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_banner_section_products(uuid, uuid, double precision, double precision, integer)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preview_festival_section_inventory(jsonb, uuid[], uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.festival_seller_matches(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_eligible_sellers_festival_published(uuid)
  TO authenticated, service_role;
