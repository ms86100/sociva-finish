-- Extra seller facts and admin lists. Seller rows stay aggregate-only.

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
        AND COALESCE(sdl.results_count, 0) > 0
        AND sdl.user_id IS NOT NULL
        AND (
          sdl.category IN (
            SELECT p.category FROM public.products p
            WHERE p.seller_id = p_seller_id AND p.category IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.seller_id = p_seller_id
              AND length(btrim(sdl.search_term)) >= 2
              AND position(lower(btrim(sdl.search_term)) in lower(p.name)) > 0
          )
        )
    ),
    'settled_revenue', COALESCE((
      SELECT sum(o.total_amount) FROM public.orders o
      WHERE o.seller_id = p_seller_id
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
        ORDER BY o.created_at DESC
        LIMIT 8
      ) r
    ), '[]'::jsonb),
    'demand', COALESCE((
      SELECT jsonb_agg(to_jsonb(d))
      FROM (
        SELECT lower(btrim(sdl.search_term)) AS search_term,
          count(DISTINCT sdl.user_id)::integer AS unique_users
        FROM public.search_demand_log sdl
        WHERE sdl.searched_at >= now() - interval '30 days'
          AND COALESCE(sdl.results_count, 0) = 0
          AND length(btrim(sdl.search_term)) >= 2
          AND (
            sdl.society_id IS NULL
            OR sdl.society_id = (SELECT society_id FROM public.seller_profiles WHERE id = p_seller_id)
          )
          AND (
            sdl.category IN (
              SELECT p.category FROM public.products p
              WHERE p.seller_id = p_seller_id AND p.category IS NOT NULL
            )
            OR sdl.category IS NULL
          )
        GROUP BY 1
        ORDER BY unique_users DESC
        LIMIT 8
      ) d
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_market_overview(p_society_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN jsonb_build_object(
    'views_30d', (
      SELECT count(*)::integer FROM public.product_views v
      WHERE v.viewed_at >= now() - interval '30 days'
    ),
    'cart_adds_30d', (
      SELECT count(*)::integer FROM public.cart_add_log c
      WHERE c.created_at >= now() - interval '30 days'
    ),
    'searches_30d', (
      SELECT count(*)::integer FROM public.search_demand_log s
      WHERE s.searched_at >= now() - interval '30 days'
        AND (p_society_id IS NULL OR s.society_id = p_society_id)
    ),
    'zero_result_searches_30d', (
      SELECT count(*)::integer FROM public.search_demand_log s
      WHERE s.searched_at >= now() - interval '30 days'
        AND COALESCE(s.results_count, 0) = 0
        AND (p_society_id IS NULL OR s.society_id = p_society_id)
    ),
    'onboarding_started', (
      SELECT count(*)::integer FROM public.seller_onboarding_attempts
    ),
    'pending_stores', (
      SELECT count(*)::integer FROM public.seller_profiles sp
      WHERE sp.verification_status::text = 'pending'
        AND (p_society_id IS NULL OR sp.society_id = p_society_id)
    ),
    'active_users_30d', (
      SELECT count(*)::integer FROM (
        SELECT v.viewer_id AS user_id FROM public.product_views v
        WHERE v.viewer_id IS NOT NULL AND v.viewed_at >= now() - interval '30 days'
        UNION
        SELECT s.user_id FROM public.search_demand_log s
        WHERE s.user_id IS NOT NULL AND s.searched_at >= now() - interval '30 days'
        UNION
        SELECT c.user_id FROM public.cart_add_log c
        WHERE c.created_at >= now() - interval '30 days'
        UNION
        SELECT o.buyer_id FROM public.orders o
        WHERE o.created_at >= now() - interval '30 days'
      ) people
    ),
    'new_users_30d', (
      SELECT count(*)::integer FROM public.profiles pr
      WHERE pr.created_at >= now() - interval '30 days'
    ),
    'active_sellers', (
      SELECT count(*)::integer FROM public.seller_profiles sp
      WHERE sp.verification_status::text = 'approved'
        AND COALESCE(sp.is_available, false)
        AND NOT COALESCE(sp.vacation_mode, false)
        AND (p_society_id IS NULL OR sp.society_id = p_society_id)
    ),
    'orders_today', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    ),
    'revenue_30d', COALESCE((
      SELECT sum(o.total_amount) FROM public.orders o
      WHERE o.created_at >= now() - interval '30 days'
        AND o.status::text IN ('delivered', 'completed', 'buyer_received')
        AND COALESCE(o.payment_status::text, '') <> 'refunded'
    ), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_intelligence(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x))
    FROM (
      SELECT
        t.search_term,
        count(*)::integer AS searches,
        count(DISTINCT t.user_id)::integer AS unique_users,
        bool_and(COALESCE(t.results_count, 0) = 0) AS no_results,
        (
          bool_and(COALESCE(t.results_count, 0) = 0)
          AND count(DISTINCT t.user_id) >= 2
        ) AS opportunity,
        (
          SELECT count(DISTINCT o.id)::integer
          FROM public.search_demand_log s2
          JOIN public.orders o
            ON o.buyer_id = s2.user_id
           AND o.created_at >= s2.searched_at
           AND o.created_at < s2.searched_at + interval '7 days'
          WHERE lower(btrim(s2.search_term)) = t.search_term
            AND s2.searched_at >= now() - interval '30 days'
        ) AS orders_followed
      FROM (
        SELECT lower(btrim(s.search_term)) AS search_term, s.user_id, s.results_count
        FROM public.search_demand_log s
        WHERE s.searched_at >= now() - interval '30 days'
          AND length(btrim(COALESCE(s.search_term, ''))) >= 2
      ) t
      GROUP BY t.search_term
      ORDER BY unique_users DESC, searches DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_seller_directory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x))
    FROM (
      SELECT
        sp.id AS seller_id,
        pr.name AS owner_name,
        pr.phone AS owner_phone,
        sp.business_name AS store_name,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.seller_id = sp.id
              AND o.status::text IN ('delivered', 'completed', 'buyer_received')
          ) THEN 'first_order'
          WHEN sp.business_name ILIKE '[HOLD]%' THEN 'hold'
          WHEN sp.business_name ILIKE '[ARCHIVED]%' THEN 'archived'
          WHEN sp.verification_status::text = 'approved' AND COALESCE(sp.is_available, false) THEN 'live'
          WHEN sp.verification_status::text = 'approved' THEN 'approved'
          WHEN sp.verification_status::text = 'rejected' THEN 'rejected'
          WHEN sp.verification_status::text = 'pending' THEN 'submitted'
          ELSE 'store_details'
        END AS stage,
        (SELECT count(*)::integer FROM public.products p WHERE p.seller_id = sp.id) AS products,
        (
          SELECT count(*)::integer FROM public.product_views v
          JOIN public.products p ON p.id = v.product_id
          WHERE p.seller_id = sp.id AND v.viewed_at >= now() - interval '30 days'
        ) AS views,
        (
          SELECT count(*)::integer FROM public.cart_add_log c
          WHERE c.seller_id = sp.id AND c.created_at >= now() - interval '30 days'
        ) AS cart_adds,
        (
          SELECT count(*)::integer FROM public.orders o
          WHERE o.seller_id = sp.id AND o.created_at >= now() - interval '30 days'
        ) AS orders,
        (
          SELECT count(*)::integer FROM public.orders o
          WHERE o.seller_id = sp.id
            AND o.status::text IN (
              'placed', 'pending', 'accepted', 'confirmed', 'preparing', 'ready',
              'payment_pending', 'assigned', 'scheduled', 'in_progress'
            )
        ) AS open_orders,
        (
          SELECT count(*)::integer FROM public.orders o
          WHERE o.seller_id = sp.id
            AND o.status::text = 'enquired'
            AND NOT EXISTS (
              SELECT 1 FROM public.seller_contact_interactions sci
              WHERE sci.order_id = o.id AND sci.status IN ('responded', 'closed')
            )
        ) AS unanswered,
        COALESCE((
          SELECT sca.available FROM public.seller_credit_accounts sca WHERE sca.seller_id = sp.id
        ), 0) AS credit_available,
        sp.updated_at AS last_active_at
      FROM public.seller_profiles sp
      JOIN public.profiles pr ON pr.id = sp.user_id
      ORDER BY sp.updated_at DESC NULLS LAST
      LIMIT 40
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_product_viewers(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;
  IF p_product_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x))
    FROM (
      SELECT
        pr.name,
        pr.phone,
        max(v.viewed_at) AS viewed_at,
        (
          SELECT d.platform FROM public.device_tokens d
          WHERE d.user_id = v.viewer_id
          ORDER BY d.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS platform
      FROM public.product_views v
      JOIN public.profiles pr ON pr.id = v.viewer_id
      WHERE v.product_id = p_product_id
        AND v.viewer_id IS NOT NULL
        AND v.viewed_at >= now() - interval '30 days'
      GROUP BY pr.name, pr.phone, v.viewer_id
      ORDER BY max(v.viewed_at) DESC
      LIMIT 40
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_seller_funnel()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin required';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_object_agg(stage, n)
    FROM (
      SELECT stage, count(*)::integer AS n
      FROM (
        SELECT CASE
          WHEN sp.id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.seller_id = sp.id
              AND o.status::text IN ('delivered', 'completed', 'buyer_received')
          ) THEN 'first_order'
          WHEN sp.business_name ILIKE '[HOLD]%' THEN 'hold'
          WHEN sp.business_name ILIKE '[ARCHIVED]%' THEN 'archived'
          WHEN sp.verification_status::text = 'approved' AND COALESCE(sp.is_available, false) THEN 'live'
          WHEN sp.verification_status::text = 'approved' THEN 'approved'
          WHEN sp.verification_status::text = 'rejected' THEN 'rejected'
          WHEN sp.verification_status::text = 'pending' THEN 'submitted'
          ELSE COALESCE(a.current_stage, 'started')
        END AS stage
        FROM public.seller_onboarding_attempts a
        LEFT JOIN public.seller_profiles sp ON sp.id = a.store_id
      ) stages
      GROUP BY stage
    ) counted
  ), '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.seller_store_insights_more(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_market_overview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_search_intelligence(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_seller_directory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_product_viewers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_seller_funnel() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.seller_store_insights_more(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_market_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_intelligence(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seller_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_product_viewers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seller_funnel() TO authenticated;
