-- Wrap leftover browse/search RPCs with sociva_assert_rate_limit.
-- Same generous budget as search_products_v2: 120 / 60s per user (or anon bucket).

CREATE OR REPLACE FUNCTION public.search_products_fts(
  _query text,
  _lat double precision DEFAULT NULL::double precision,
  _lng double precision DEFAULT NULL::double precision,
  _radius_km double precision DEFAULT 10,
  _category text DEFAULT NULL::text,
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
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $$
DECLARE
  _tsquery tsquery;
  _has_query boolean;
  _normalized text;
  _collapsed text;
BEGIN
  PERFORM public.sociva_assert_rate_limit(
    'search_products_fts:' || coalesce(auth.uid()::text, 'anon'),
    120,
    60
  );

  _normalized := btrim(COALESCE(_query, ''));
  _collapsed := replace(lower(_normalized), ' ', '');
  _has_query := (_normalized <> '');

  IF _has_query THEN
    BEGIN
      _tsquery := to_tsquery('english',
        array_to_string(
          array(SELECT lexeme || ':*' FROM unnest(
            string_to_array(regexp_replace(_normalized, '[[:space:]]+', ' ', 'g'), ' ')
          ) AS lexeme WHERE length(lexeme) > 0),
          ' & '
        )
      );
    EXCEPTION WHEN OTHERS THEN
      _tsquery := plainto_tsquery('english', _normalized);
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
    CASE
      WHEN NOT _has_query THEN 0.0
      WHEN lower(p.name) = lower(_normalized) THEN 1.0
      WHEN lower(p.name) LIKE '%' || lower(_normalized) || '%' THEN 0.85
      WHEN length(_collapsed) >= 3 AND replace(lower(p.name), ' ', '') LIKE '%' || _collapsed || '%' THEN 0.8
      WHEN _tsquery IS NOT NULL THEN ts_rank(p.search_vector, _tsquery)
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
      OR p.name ILIKE '%' || _normalized || '%'
      OR (length(_collapsed) >= 3 AND replace(lower(p.name), ' ', '') LIKE '%' || _collapsed || '%')
      OR sp.business_name ILIKE '%' || _normalized || '%'
    )
    AND (_category IS NULL OR p.category::text = _category)
  ORDER BY rank DESC, p.is_bestseller DESC NULLS LAST, p.name
  LIMIT _limit
  OFFSET _offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_products_fts(
  text, double precision, double precision, double precision, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_fts(
  text, double precision, double precision, double precision, text, integer, integer
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_society_search_suggestions(
  _society_id uuid,
  _limit integer DEFAULT 8
)
RETURNS TABLE(term text, count bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $$
BEGIN
  PERFORM public.sociva_assert_rate_limit(
    'search_suggestions:' || coalesce(auth.uid()::text, 'anon'),
    120,
    60
  );

  RETURN QUERY
  SELECT
    lower(btrim(sdl.search_term)) AS term,
    COUNT(DISTINCT sdl.user_id)::bigint AS count
  FROM public.search_demand_log sdl
  WHERE sdl.society_id = (
      SELECT pr.society_id
      FROM public.profiles pr
      WHERE pr.id = auth.uid()
    )
    AND sdl.user_id IS NOT NULL
    AND sdl.user_id IS DISTINCT FROM auth.uid()
    AND sdl.searched_at > now() - interval '14 days'
    AND length(btrim(sdl.search_term)) >= 2
    AND COALESCE(sdl.results_count, 0) > 0
  GROUP BY lower(btrim(sdl.search_term))
  HAVING COUNT(DISTINCT sdl.user_id) >= 2
  ORDER BY count DESC, term
  LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 25);
END;
$$;

REVOKE ALL ON FUNCTION public.get_society_search_suggestions(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_society_search_suggestions(uuid, integer)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_products_for_sellers(
  _seller_ids uuid[],
  _category text DEFAULT NULL::text,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0,
  _lat double precision DEFAULT NULL::double precision,
  _lng double precision DEFAULT NULL::double precision
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
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $$
DECLARE
  v_per_seller integer := 60;
BEGIN
  PERFORM public.sociva_assert_rate_limit(
    'get_products_for_sellers:' || coalesce(auth.uid()::text, 'anon'),
    120,
    60
  );

  RETURN QUERY
  SELECT x.product_id, x.seller_id, x.product_name, x.price, x.image_url, x.category,
         x.is_veg, x.is_available, x.is_bestseller, x.is_recommended, x.is_urgent,
         x.action_type, x.contact_phone, x.mrp, x.discount_percentage, x.description
  FROM (
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
      p.description,
      ROW_NUMBER() OVER (
        ORDER BY p.is_bestseller DESC NULLS LAST,
                 p.is_recommended DESC NULLS LAST,
                 p.name
      ) AS global_rn
    FROM unnest(_seller_ids) AS sid(id)
    CROSS JOIN LATERAL (
      SELECT p2.*
      FROM public.products p2
      WHERE p2.seller_id = sid.id
        AND p2.is_available = true
        AND p2.approval_status = 'approved'
        AND (_category IS NULL OR p2.category::text = _category)
        AND public.seller_is_discoverable_to_buyer(p2.seller_id, _lat, _lng)
      ORDER BY p2.is_bestseller DESC NULLS LAST,
               p2.is_recommended DESC NULLS LAST,
               p2.name
      LIMIT v_per_seller
    ) p
  ) x
  WHERE x.global_rn > COALESCE(_offset, 0)
  ORDER BY x.global_rn
  LIMIT GREATEST(
    COALESCE(_limit, 20),
    v_per_seller * GREATEST(COALESCE(array_length(_seller_ids, 1), 0), 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_products_for_sellers(
  uuid[], text, integer, integer, double precision, double precision
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_products_for_sellers(
  uuid[], text, integer, integer, double precision, double precision
) TO anon, authenticated, service_role;
