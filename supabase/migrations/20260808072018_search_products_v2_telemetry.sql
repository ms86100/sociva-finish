-- Additive search correctness and telemetry contract.
-- The legacy search_products_fts RPC remains untouched for immediate client fallback.

ALTER TABLE public.search_demand_log
  ADD COLUMN IF NOT EXISTS filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS retrieval_mode text,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS session_query_id uuid;

-- Some deployed environments already have these columns even though the historical
-- migration chain does not. Keep this migration safe for both states.
ALTER TABLE public.search_demand_log
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS results_count integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_search_demand_session_query
  ON public.search_demand_log (session_query_id)
  WHERE session_query_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_search_demand_unmet
  ON public.search_demand_log (society_id, searched_at DESC)
  WHERE COALESCE(results_count, 0) = 0;

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
      -- Society visibility is authorization-sensitive. Never trust a caller-supplied
      -- society over the authenticated profile; keep the argument for RPC compatibility.
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
      CASE
        WHEN _lat IS NOT NULL AND _lng IS NOT NULL THEN
          public.haversine_km(
            _lat,
            _lng,
            COALESCE(sp.latitude, s.latitude::double precision),
            COALESCE(sp.longitude, s.longitude::double precision)
          )
        ELSE NULL
      END AS computed_distance_km,
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
      AND sp.verification_status = 'approved'
      AND sp.is_available = true
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
        _lat IS NULL OR _lng IS NULL
        OR (
          COALESCE(sp.latitude, s.latitude::double precision) IS NOT NULL
          AND COALESCE(sp.longitude, s.longitude::double precision) IS NOT NULL
          AND COALESCE(sp.latitude, s.latitude::double precision)
              BETWEEN (_lat - i.radius_km * 0.009) AND (_lat + i.radius_km * 0.009)
          AND COALESCE(sp.longitude, s.longitude::double precision)
              BETWEEN (_lng - i.radius_km * 0.009) AND (_lng + i.radius_km * 0.009)
          AND public.haversine_km(
                _lat,
                _lng,
                COALESCE(sp.latitude, s.latitude::double precision),
                COALESCE(sp.longitude, s.longitude::double precision)
              ) <= LEAST(i.radius_km, COALESCE(sp.delivery_radius_km, i.radius_km))
        )
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

CREATE OR REPLACE FUNCTION public.log_committed_search(
  _session_query_id uuid,
  _search_term text,
  _society_id uuid DEFAULT NULL,
  _category text DEFAULT NULL,
  _result_count integer DEFAULT NULL,
  _filters jsonb DEFAULT '{}'::jsonb,
  _retrieval_mode text DEFAULT NULL,
  _latency_ms integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
  resolved_society_id uuid;
BEGIN
  IF _session_query_id IS NULL OR length(btrim(COALESCE(_search_term, ''))) < 2 THEN
    RETURN false;
  END IF;

  -- Do not let clients attribute demand to a society they do not belong to.
  SELECT pr.society_id
  INTO resolved_society_id
  FROM public.profiles pr
  WHERE pr.id = auth.uid();

  INSERT INTO public.search_demand_log (
    society_id,
    user_id,
    search_term,
    category,
    results_count,
    filters,
    retrieval_mode,
    latency_ms,
    session_query_id
  )
  VALUES (
    resolved_society_id,
    auth.uid(),
    lower(btrim(_search_term)),
    _category,
    GREATEST(COALESCE(_result_count, 0), 0),
    COALESCE(_filters, '{}'::jsonb),
    left(NULLIF(btrim(_retrieval_mode), ''), 40),
    LEAST(GREATEST(COALESCE(_latency_ms, 0), 0), 600000),
    _session_query_id
  )
  ON CONFLICT (session_query_id) WHERE session_query_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.log_committed_search(
  uuid, text, uuid, text, integer, jsonb, text, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_committed_search(
  uuid, text, uuid, text, integer, jsonb, text, integer
) TO authenticated;

-- Replace historical overloads with one unambiguous contract.
DROP FUNCTION IF EXISTS public.get_unmet_demand(uuid, integer);
DROP FUNCTION IF EXISTS public.get_unmet_demand(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_unmet_demand(uuid, uuid, integer);

CREATE FUNCTION public.get_unmet_demand(
  _society_id uuid,
  _seller_id uuid DEFAULT NULL,
  _limit integer DEFAULT 20
)
RETURNS TABLE(search_term text, search_count bigint, last_searched timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH caller AS (
    SELECT
      EXISTS (
        SELECT 1
        FROM public.seller_profiles sp
        WHERE sp.id = _seller_id
          AND sp.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.society_admins sa
        WHERE sa.user_id = auth.uid()
          AND sa.society_id = _society_id
          AND sa.deactivated_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'admin'
      ) AS allowed
  )
  SELECT
    sdl.search_term,
    COUNT(*)::bigint AS search_count,
    MAX(sdl.searched_at) AS last_searched
  FROM public.search_demand_log sdl
  CROSS JOIN caller c
  WHERE c.allowed
    AND sdl.searched_at > now() - interval '30 days'
    AND COALESCE(sdl.results_count, 0) = 0
    AND CASE
      WHEN _society_id IS NOT NULL THEN sdl.society_id = _society_id
      WHEN _seller_id IS NOT NULL THEN (
        sdl.society_id IS NULL
        OR sdl.society_id IN (
          SELECT DISTINCT COALESCE(o.buyer_society_id, o.society_id)
          FROM public.orders o
          WHERE o.seller_id = _seller_id
            AND COALESCE(o.buyer_society_id, o.society_id) IS NOT NULL
        )
      )
      ELSE sdl.society_id IS NULL
    END
  GROUP BY sdl.search_term
  HAVING COUNT(*) >= 2
  ORDER BY search_count DESC, last_searched DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.get_unmet_demand(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unmet_demand(uuid, uuid, integer) TO authenticated;

-- Fix the deployed function's stale created_at reference and only suggest
-- successful committed searches.
CREATE OR REPLACE FUNCTION public.get_society_search_suggestions(
  _society_id uuid,
  _limit integer DEFAULT 8
)
RETURNS TABLE(term text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  SELECT
    lower(btrim(sdl.search_term)) AS term,
    COUNT(*)::bigint AS count
  FROM public.search_demand_log sdl
  WHERE sdl.society_id = (
      SELECT pr.society_id
      FROM public.profiles pr
      WHERE pr.id = auth.uid()
    )
    AND sdl.searched_at > now() - interval '14 days'
    AND length(btrim(sdl.search_term)) >= 2
    AND COALESCE(sdl.results_count, 0) > 0
  GROUP BY lower(btrim(sdl.search_term))
  HAVING COUNT(*) >= 2
  ORDER BY count DESC, term
  LIMIT LEAST(GREATEST(COALESCE(_limit, 8), 1), 25);
$$;

REVOKE ALL ON FUNCTION public.get_society_search_suggestions(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_society_search_suggestions(uuid, integer) TO authenticated;
