-- Seller stats: 30-day windows, live order counts, clustered nearby searches.
-- Search telemetry: drop in-progress keystroke prefixes from the same user.

DROP POLICY IF EXISTS "users_delete_own_search_demand" ON public.search_demand_log;
CREATE POLICY "users_delete_own_search_demand"
ON public.search_demand_log
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer;
  resolved_society_id uuid;
  v_uid uuid := auth.uid();
  v_term text := lower(btrim(COALESCE(_search_term, '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF _session_query_id IS NULL OR length(v_term) < 3 THEN
    RETURN false;
  END IF;

  SELECT pr.society_id
  INTO resolved_society_id
  FROM public.profiles pr
  WHERE pr.id = v_uid;

  DELETE FROM public.search_demand_log
  WHERE user_id = v_uid
    AND searched_at > now() - interval '20 minutes'
    AND length(btrim(search_term)) < length(v_term)
    AND length(btrim(search_term)) >= 2
    AND v_term LIKE btrim(search_term) || '%';

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
    v_uid,
    v_term,
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

CREATE OR REPLACE FUNCTION public.seller_store_insights(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.id = p_seller_id AND sp.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT jsonb_build_object(
    'window_days', 30,
    'views_30d', (
      SELECT count(*)::integer
      FROM public.product_views v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.seller_id = p_seller_id
        AND v.viewed_at >= now() - interval '30 days'
    ),
    'unique_viewers_30d', (
      SELECT count(DISTINCT v.viewer_id)::integer
      FROM public.product_views v
      JOIN public.products p ON p.id = v.product_id
      WHERE p.seller_id = p_seller_id
        AND v.viewer_id IS NOT NULL
        AND v.viewed_at >= now() - interval '30 days'
    ),
    'cart_adds_30d', (
      SELECT count(*)::integer FROM public.cart_add_log c
      WHERE c.seller_id = p_seller_id
        AND c.created_at >= now() - interval '30 days'
    ),
    'orders_30d', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND o.status::text <> 'payment_pending'
    ),
    'completed', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND (
          o.status::text IN ('delivered', 'completed', 'buyer_received')
          OR EXISTS (
            SELECT 1 FROM public.category_status_flows csf
            WHERE csf.status_key = o.status::text
              AND csf.is_terminal IS TRUE
              AND csf.is_success IS TRUE
          )
        )
    ),
    'completed_30d', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND (
          o.status::text IN ('delivered', 'completed', 'buyer_received')
          OR EXISTS (
            SELECT 1 FROM public.category_status_flows csf
            WHERE csf.status_key = o.status::text
              AND csf.is_terminal IS TRUE
              AND csf.is_success IS TRUE
          )
        )
    ),
    'rejected', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND (
          o.status::text = 'rejected'
          OR (o.status::text = 'cancelled' AND NULLIF(btrim(COALESCE(o.rejection_reason, '')), '') IS NOT NULL)
        )
    ),
    'rejected_30d', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND (
          o.status::text = 'rejected'
          OR (o.status::text = 'cancelled' AND NULLIF(btrim(COALESCE(o.rejection_reason, '')), '') IS NOT NULL)
        )
    ),
    'cancelled', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND o.status::text = 'cancelled'
        AND NULLIF(btrim(COALESCE(o.rejection_reason, '')), '') IS NULL
    ),
    'cancelled_30d', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND o.status::text = 'cancelled'
        AND NULLIF(btrim(COALESCE(o.rejection_reason, '')), '') IS NULL
    ),
    'open_orders', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.status::text IN (
          'placed', 'pending', 'accepted', 'confirmed', 'preparing', 'ready',
          'assigned', 'scheduled', 'in_progress', 'requested', 'booked', 'rescheduled'
        )
    ),
    'out_for_delivery', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND (
          o.status::text IN ('picked_up', 'on_the_way', 'en_route', 'at_gate', 'arrived')
          OR EXISTS (
            SELECT 1 FROM public.category_status_flows csf
            WHERE csf.status_key = o.status::text AND csf.is_transit IS TRUE
          )
        )
    ),
    'ready', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id AND o.status::text = 'ready'
    ),
    'preparing', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id AND o.status::text IN ('preparing', 'in_progress')
    ),
    'unanswered', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.status::text = 'enquired'
        AND NOT EXISTS (
          SELECT 1 FROM public.seller_contact_interactions sci
          WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
        )
    ),
    'credit_available', COALESCE((
      SELECT sca.available FROM public.seller_credit_accounts sca WHERE sca.seller_id = p_seller_id
    ), 0),
    'credit_reserved', COALESCE((
      SELECT sca.reserved FROM public.seller_credit_accounts sca WHERE sca.seller_id = p_seller_id
    ), 0),
    'products', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.views DESC)
      FROM (
        SELECT
          p.id AS product_id,
          p.name,
          p.price,
          (
            SELECT count(*)::integer FROM public.product_views v
            WHERE v.product_id = p.id AND v.viewed_at >= now() - interval '30 days'
          ) AS views,
          (
            SELECT count(DISTINCT v.viewer_id)::integer FROM public.product_views v
            WHERE v.product_id = p.id AND v.viewer_id IS NOT NULL
              AND v.viewed_at >= now() - interval '30 days'
          ) AS unique_viewers,
          (
            SELECT count(*)::integer FROM public.cart_add_log c
            WHERE c.product_id = p.id AND c.created_at >= now() - interval '30 days'
          ) AS cart_adds,
          (
            SELECT count(DISTINCT oi.order_id)::integer
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
            WHERE oi.product_id = p.id
              AND o.created_at >= now() - interval '30 days'
          ) AS orders,
          (
            SELECT max(v.viewed_at) FROM public.product_views v WHERE v.product_id = p.id
          ) AS last_viewed_at
        FROM public.products p
        WHERE p.seller_id = p_seller_id
        ORDER BY views DESC
        LIMIT 20
      ) x
    ), '[]'::jsonb),
    'demand', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.unique_users DESC, d.searches DESC)
      FROM (
        WITH catalog_tokens AS (
          SELECT DISTINCT tok
          FROM (
            SELECT regexp_replace(lower(COALESCE(p.name, '')), '[^a-z0-9 ]', '', 'g') AS name
            FROM public.products p
            WHERE p.seller_id = p_seller_id
            UNION ALL
            SELECT regexp_replace(lower(COALESCE(sp.business_name, '')), '[^a-z0-9 ]', '', 'g')
            FROM public.seller_profiles sp
            WHERE sp.id = p_seller_id
          ) names
          CROSS JOIN LATERAL unnest(string_to_array(btrim(names.name), ' ')) AS tok
          WHERE length(tok) >= 3
        ),
        normalized AS (
          SELECT
            nullif(regexp_replace(lower(btrim(sdl.search_term)), '[^a-z0-9 ]', '', 'g'), '') AS term,
            sdl.user_id,
            COALESCE(sdl.results_count, 0) AS results_count,
            sdl.searched_at
          FROM public.search_demand_log sdl
          WHERE sdl.searched_at >= now() - interval '30 days'
            AND length(btrim(sdl.search_term)) >= 3
            AND (
              sdl.society_id IS NULL
              OR sdl.society_id = (SELECT society_id FROM public.seller_profiles WHERE id = p_seller_id)
            )
        ),
        relevant AS (
          SELECT n.*
          FROM normalized n
          WHERE n.term IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM catalog_tokens t
              WHERE t.tok = n.term
                 OR t.tok LIKE n.term || '%'
                 OR (length(n.term) >= 4 AND n.term LIKE t.tok || '%')
                 OR (length(n.term) >= 4 AND similarity(n.term, t.tok) >= 0.4)
            )
        ),
        term_set AS (
          SELECT DISTINCT term FROM relevant
        ),
        canon_map AS (
          SELECT
            t.term,
            (
              SELECT t2.term
              FROM term_set t2
              WHERE t2.term LIKE t.term || '%'
                 OR (length(t.term) >= 4 AND length(t2.term) >= 4 AND similarity(t.term, t2.term) >= 0.55)
              ORDER BY length(t2.term) DESC, t2.term
              LIMIT 1
            ) AS canonical
          FROM term_set t
        )
        SELECT
          COALESCE((
            SELECT tok FROM catalog_tokens ct
            WHERE ct.tok = c.canonical
               OR ct.tok LIKE c.canonical || '%'
               OR (length(c.canonical) >= 4 AND similarity(c.canonical, ct.tok) >= 0.4)
            ORDER BY (ct.tok = c.canonical) DESC, similarity(c.canonical, ct.tok) DESC, length(ct.tok) DESC
            LIMIT 1
          ), c.canonical) AS search_term,
          count(DISTINCT r.user_id)::integer AS unique_users,
          count(*)::integer AS searches,
          bool_or(
            EXISTS (
              SELECT 1 FROM catalog_tokens ct
              WHERE ct.tok = c.canonical
                 OR position(c.canonical in ct.tok) > 0
                 OR position(ct.tok in c.canonical) > 0
            )
          ) AS matched_your_listings,
          bool_and(r.results_count = 0) AS no_results,
          max(r.searched_at) AS last_searched,
          COALESCE((
            SELECT jsonb_agg(x.term ORDER BY x.term)
            FROM canon_map x
            WHERE x.canonical = c.canonical AND x.term <> c.canonical
          ), '[]'::jsonb) AS aliases
        FROM relevant r
        JOIN canon_map c ON c.term = r.term
        GROUP BY c.canonical
        ORDER BY unique_users DESC, searches DESC
        LIMIT 15
      ) d
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_store_insights_more(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.seller_profiles sp
      WHERE sp.id = p_seller_id AND sp.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT jsonb_build_object(
    'enquiries_30d', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND (o.order_type = 'enquiry' OR o.status::text IN ('enquired', 'quoted'))
    ),
    'catalog_searches_30d', (
      SELECT count(DISTINCT sdl.user_id)::integer
      FROM public.search_demand_log sdl
      WHERE sdl.searched_at >= now() - interval '30 days'
        AND sdl.user_id IS NOT NULL
        AND length(btrim(sdl.search_term)) >= 3
        AND EXISTS (
          SELECT 1
          FROM public.products p
          LEFT JOIN public.seller_profiles sp ON sp.id = p_seller_id
          WHERE p.seller_id = p_seller_id
            AND (
              position(lower(btrim(sdl.search_term)) in lower(p.name)) > 0
              OR position(lower(p.name) in lower(btrim(sdl.search_term))) > 0
              OR similarity(lower(btrim(sdl.search_term)), lower(split_part(p.name, ' ', 1))) >= 0.4
              OR (sp.business_name IS NOT NULL AND position(lower(btrim(sdl.search_term)) in lower(sp.business_name)) > 0)
            )
        )
    ),
    'settled_revenue', COALESCE((
      SELECT sum(o.total_amount) FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND o.status::text IN ('delivered', 'completed', 'buyer_received')
        AND COALESCE(o.payment_status::text, '') <> 'refunded'
    ), 0),
    'settled_revenue_30d', COALESCE((
      SELECT sum(o.total_amount) FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.created_at >= now() - interval '30 days'
        AND o.status::text IN ('delivered', 'completed', 'buyer_received')
        AND COALESCE(o.payment_status::text, '') <> 'refunded'
    ), 0),
    'is_available', (
      SELECT COALESCE(sp.is_available, false) FROM public.seller_profiles sp WHERE sp.id = p_seller_id
    ),
    'vacation_mode', (
      SELECT COALESCE(sp.vacation_mode, false) FROM public.seller_profiles sp WHERE sp.id = p_seller_id
    ),
    'recent_orders', COALESCE((
      SELECT jsonb_agg(to_jsonb(r))
      FROM (
        SELECT o.status::text AS status, o.total_amount, o.created_at
        FROM public.orders o
        WHERE o.seller_id = p_seller_id
          AND o.status::text <> 'payment_pending'
        ORDER BY o.created_at DESC
        LIMIT 8
      ) r
    ), '[]'::jsonb),
    'searches', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.unique_users DESC, d.searches DESC)
      FROM (
        WITH catalog_tokens AS (
          SELECT DISTINCT tok
          FROM (
            SELECT regexp_replace(lower(COALESCE(p.name, '')), '[^a-z0-9 ]', '', 'g') AS name
            FROM public.products p
            WHERE p.seller_id = p_seller_id
            UNION ALL
            SELECT regexp_replace(lower(COALESCE(sp.business_name, '')), '[^a-z0-9 ]', '', 'g')
            FROM public.seller_profiles sp
            WHERE sp.id = p_seller_id
          ) names
          CROSS JOIN LATERAL unnest(string_to_array(btrim(names.name), ' ')) AS tok
          WHERE length(tok) >= 3
        ),
        normalized AS (
          SELECT
            nullif(regexp_replace(lower(btrim(sdl.search_term)), '[^a-z0-9 ]', '', 'g'), '') AS term,
            sdl.user_id,
            COALESCE(sdl.results_count, 0) AS results_count,
            sdl.searched_at
          FROM public.search_demand_log sdl
          WHERE sdl.searched_at >= now() - interval '30 days'
            AND length(btrim(sdl.search_term)) >= 3
            AND (
              sdl.society_id IS NULL
              OR sdl.society_id = (SELECT society_id FROM public.seller_profiles WHERE id = p_seller_id)
            )
        ),
        relevant AS (
          SELECT n.*
          FROM normalized n
          WHERE n.term IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM catalog_tokens t
              WHERE t.tok = n.term
                 OR t.tok LIKE n.term || '%'
                 OR (length(n.term) >= 4 AND n.term LIKE t.tok || '%')
                 OR (length(n.term) >= 4 AND similarity(n.term, t.tok) >= 0.4)
            )
        ),
        term_set AS (
          SELECT DISTINCT term FROM relevant
        ),
        canon_map AS (
          SELECT
            t.term,
            (
              SELECT t2.term
              FROM term_set t2
              WHERE t2.term LIKE t.term || '%'
                 OR (length(t.term) >= 4 AND length(t2.term) >= 4 AND similarity(t.term, t2.term) >= 0.55)
              ORDER BY length(t2.term) DESC, t2.term
              LIMIT 1
            ) AS canonical
          FROM term_set t
        )
        SELECT
          COALESCE((
            SELECT tok FROM catalog_tokens ct
            WHERE ct.tok = c.canonical
               OR ct.tok LIKE c.canonical || '%'
               OR (length(c.canonical) >= 4 AND similarity(c.canonical, ct.tok) >= 0.4)
            ORDER BY (ct.tok = c.canonical) DESC, similarity(c.canonical, ct.tok) DESC, length(ct.tok) DESC
            LIMIT 1
          ), c.canonical) AS search_term,
          count(DISTINCT r.user_id)::integer AS unique_users,
          count(*)::integer AS searches,
          bool_or(
            EXISTS (
              SELECT 1 FROM catalog_tokens ct
              WHERE ct.tok = c.canonical
                 OR position(c.canonical in ct.tok) > 0
                 OR position(ct.tok in c.canonical) > 0
            )
          ) AS matched_your_listings,
          bool_and(r.results_count = 0) AS no_results,
          max(r.searched_at) AS last_searched,
          COALESCE((
            SELECT jsonb_agg(x.term ORDER BY x.term)
            FROM canon_map x
            WHERE x.canonical = c.canonical AND x.term <> c.canonical
          ), '[]'::jsonb) AS aliases
        FROM relevant r
        JOIN canon_map c ON c.term = r.term
        GROUP BY c.canonical
        ORDER BY unique_users DESC, searches DESC
        LIMIT 15
      ) d
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
