-- Align category/search discovery with home marketplace:
-- society-resident sellers already gated by seller_is_discoverable_to_buyer
-- (delivery radius). Do not also require same society_id, or Coaching/Tuition
-- (and similar contact/book listings) disappear for guests and other societies
-- even when Home shows those category chips nearby.

CREATE OR REPLACE FUNCTION public.search_products_v2(
  _query text DEFAULT ''::text,
  _lat double precision DEFAULT NULL::double precision,
  _lng double precision DEFAULT NULL::double precision,
  _radius_km double precision DEFAULT 10,
  _buyer_society_id uuid DEFAULT NULL::uuid,
  _categories text[] DEFAULT NULL::text[],
  _min_rating numeric DEFAULT 0,
  _is_veg boolean DEFAULT NULL::boolean,
  _min_price numeric DEFAULT NULL::numeric,
  _max_price numeric DEFAULT NULL::numeric,
  _sort_by text DEFAULT NULL::text,
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
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $function$
  WITH input AS (
    SELECT
      NULLIF(btrim(lower(COALESCE(_query, ''))), '') AS term,
      NULLIF(replace(btrim(lower(COALESCE(_query, ''))), ' ', ''), '') AS collapsed_term,
      CASE
        WHEN NULLIF(btrim(COALESCE(_query, '')), '') IS NULL THEN NULL::tsquery
        ELSE websearch_to_tsquery('english', btrim(_query))
      END AS tsq,
      COALESCE(
        _buyer_society_id,
        (SELECT pr.society_id FROM public.profiles pr WHERE pr.id = auth.uid())
      ) AS buyer_society_id,
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
      i.collapsed_term,
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
      AND (
        -- Browse/search with buyer pin: radius + seller delivery reach
        (_lat IS NOT NULL AND _lng IS NOT NULL AND public.seller_is_discoverable_to_buyer(sp.id, _lat, _lng))
        -- Text without pin still allowed (no distance ranking)
        OR (_lat IS NULL OR _lng IS NULL)
      )
      AND (
        _lat IS NULL OR _lng IS NULL
        OR public.haversine_km(_lat, _lng, sp.latitude, sp.longitude) <= i.radius_km
      )
      AND (COALESCE(array_length(_categories, 1), 0) = 0 OR p.category::text = ANY(_categories))
      AND COALESCE(sp.rating, 0) >= COALESCE(_min_rating, 0)
      AND (_is_veg IS NULL OR p.is_veg = _is_veg)
      AND (_min_price IS NULL OR p.price >= _min_price)
      AND (_max_price IS NULL OR p.price <= _max_price)
      AND (
        i.term IS NULL
        OR lower(p.name) = i.term
        OR lower(p.name) LIKE '%' || i.term || '%'
        OR (
          i.collapsed_term IS NOT NULL
          AND length(i.collapsed_term) >= 3
          AND replace(lower(p.name), ' ', '') LIKE '%' || i.collapsed_term || '%'
        )
        OR lower(sp.business_name) LIKE '%' || i.term || '%'
        OR lower(COALESCE(p.category::text, '')) LIKE '%' || i.term || '%'
        OR (i.tsq IS NOT NULL AND p.search_vector @@ i.tsq)
        OR COALESCE((
          SELECT bool_and(
            lower(p.name) LIKE '%' || tok || '%'
            OR lower(COALESCE(p.description, '')) LIKE '%' || tok || '%'
            OR lower(sp.business_name) LIKE '%' || tok || '%'
            OR lower(COALESCE(p.category::text, '')) LIKE '%' || tok || '%'
          )
          FROM unnest(regexp_split_to_array(i.term, '[[:space:]]+')) AS tok
          WHERE length(tok) >= 2
        ), false)
      )
      -- Discovery is coordinate/radius based (same as home marketplace).
      -- Society match is ranking only via is_same_society - not an exclusion gate.
  ),
  scored AS (
    SELECT
      e.*,
      CASE
        WHEN e.term IS NULL THEN 0::real
        WHEN lower(e.product_name) = e.term THEN 5::real
        WHEN lower(e.product_name) LIKE e.term || '%' THEN 4.6::real
        WHEN lower(e.product_name) LIKE '%' || e.term || '%' THEN 4.2::real
        WHEN e.collapsed_term IS NOT NULL
          AND replace(lower(e.product_name), ' ', '') LIKE '%' || e.collapsed_term || '%' THEN 3.8::real
        WHEN COALESCE((
          SELECT bool_and(lower(e.product_name) LIKE '%' || tok || '%')
          FROM unnest(regexp_split_to_array(e.term, '[[:space:]]+')) AS tok
          WHERE length(tok) >= 2
        ), false) THEN 3.5::real
        WHEN lower(e.seller_name) LIKE '%' || e.term || '%' THEN 3.0::real
        WHEN lower(COALESCE(e.category, '')) LIKE '%' || e.term || '%' THEN 2.4::real
        ELSE GREATEST(COALESCE(ts_rank(e.search_vector, e.tsq), 0), 0.1)::real
      END AS search_rank,
      CASE
        WHEN e.term IS NULL THEN 'browse'
        WHEN lower(e.product_name) = e.term THEN 'exact'
        WHEN lower(e.product_name) LIKE '%' || e.term || '%' THEN 'phrase'
        WHEN e.collapsed_term IS NOT NULL
          AND replace(lower(e.product_name), ' ', '') LIKE '%' || e.collapsed_term || '%' THEN 'phrase'
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
$function$;

COMMENT ON FUNCTION public.search_products_v2 IS
  'Product search/browse. Discovery uses seller delivery radius; society is ranking only (not exclusion).';
