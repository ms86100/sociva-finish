-- Seller intelligence facts: one product view per person per day, cart adds, onboarding stage.
-- Seller RPCs return aggregates only. Admin RPCs may return name and phone.

DELETE FROM public.product_views a
USING public.product_views b
WHERE a.viewer_id IS NOT NULL
  AND a.viewer_id = b.viewer_id
  AND a.product_id = b.product_id
  AND (a.viewed_at AT TIME ZONE 'UTC')::date = (b.viewed_at AT TIME ZONE 'UTC')::date
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS product_views_one_per_user_product_day
  ON public.product_views (viewer_id, product_id, ((viewed_at AT TIME ZONE 'UTC')::date))
  WHERE viewer_id IS NOT NULL;

REVOKE ALL ON public.product_views FROM authenticated, anon;
GRANT SELECT (id, product_id, viewed_at) ON public.product_views TO authenticated;
GRANT INSERT (product_id, viewer_id, viewed_at) ON public.product_views TO authenticated;

CREATE TABLE IF NOT EXISTS public.cart_add_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  seller_id uuid REFERENCES public.seller_profiles(id) ON DELETE SET NULL,
  price numeric,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cart_add_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cart_add_log_insert_own ON public.cart_add_log;
CREATE POLICY cart_add_log_insert_own
  ON public.cart_add_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS cart_add_log_seller_created
  ON public.cart_add_log (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cart_add_log_product_created
  ON public.cart_add_log (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.seller_onboarding_attempts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.seller_profiles(id) ON DELETE SET NULL,
  current_stage text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  abandoned_stage text,
  platform text,
  source text
);

ALTER TABLE public.seller_onboarding_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_onboarding_attempts_own ON public.seller_onboarding_attempts;
CREATE POLICY seller_onboarding_attempts_own
  ON public.seller_onboarding_attempts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.log_product_view_daily(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_product_id IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    INSERT INTO public.product_views (product_id, viewer_id, viewed_at)
    SELECT p_product_id, auth.uid(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.product_views v
      WHERE v.viewer_id = auth.uid()
        AND v.product_id = p_product_id
        AND (v.viewed_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_cart_add(
  p_product_id uuid,
  p_seller_id uuid DEFAULT NULL,
  p_price numeric DEFAULT NULL,
  p_quantity integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller uuid;
BEGIN
  IF auth.uid() IS NULL OR p_product_id IS NULL THEN
    RETURN;
  END IF;
  SELECT seller_id INTO v_seller FROM public.products WHERE id = p_product_id;
  INSERT INTO public.cart_add_log (user_id, product_id, seller_id, price, quantity)
  VALUES (
    auth.uid(),
    p_product_id,
    COALESCE(v_seller, p_seller_id),
    p_price,
    GREATEST(COALESCE(p_quantity, 1), 1)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_seller_onboarding_attempt(
  p_stage text,
  p_store_id uuid DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_stage IS NULL OR btrim(p_stage) = '' THEN
    RETURN;
  END IF;

  IF p_stage = 'abandoned' THEN
    UPDATE public.seller_onboarding_attempts
    SET abandoned_stage = current_stage,
        last_active_at = now(),
        platform = COALESCE(p_platform, platform),
        source = COALESCE(p_source, source),
        store_id = COALESCE(p_store_id, store_id)
    WHERE user_id = auth.uid();
    RETURN;
  END IF;

  INSERT INTO public.seller_onboarding_attempts (
    user_id, store_id, current_stage, platform, source
  )
  VALUES (auth.uid(), p_store_id, p_stage, p_platform, p_source)
  ON CONFLICT (user_id) DO UPDATE
  SET current_stage = EXCLUDED.current_stage,
      store_id = COALESCE(EXCLUDED.store_id, public.seller_onboarding_attempts.store_id),
      last_active_at = now(),
      platform = COALESCE(EXCLUDED.platform, public.seller_onboarding_attempts.platform),
      source = COALESCE(EXCLUDED.source, public.seller_onboarding_attempts.source),
      completed_at = CASE
        WHEN EXCLUDED.current_stage IN ('submitted', 'approved', 'live', 'first_order')
          THEN COALESCE(public.seller_onboarding_attempts.completed_at, now())
        ELSE public.seller_onboarding_attempts.completed_at
      END;
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
    ),
    'completed', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.status::text IN ('delivered', 'completed', 'buyer_received')
    ),
    'rejected', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND (
          o.status::text = 'rejected'
          OR (o.status::text = 'cancelled' AND NULLIF(btrim(COALESCE(o.rejection_reason, '')), '') IS NOT NULL)
        )
    ),
    'cancelled', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.status::text = 'cancelled'
        AND NULLIF(btrim(COALESCE(o.rejection_reason, '')), '') IS NULL
    ),
    'open_orders', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.status::text IN (
          'placed', 'pending', 'accepted', 'confirmed', 'preparing', 'ready',
          'payment_pending', 'assigned', 'scheduled', 'in_progress'
        )
    ),
    'out_for_delivery', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id
        AND o.status::text IN ('picked_up', 'on_the_way', 'en_route', 'at_gate', 'arrived')
    ),
    'ready', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id AND o.status::text = 'ready'
    ),
    'preparing', (
      SELECT count(*)::integer FROM public.orders o
      WHERE o.seller_id = p_seller_id AND o.status::text = 'preparing'
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
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_product_demand(p_limit integer DEFAULT 20)
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
        p.id AS product_id,
        p.name,
        p.price,
        sp.business_name AS store_name,
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
          WHERE oi.product_id = p.id
        ) AS orders
      FROM public.products p
      JOIN public.seller_profiles sp ON sp.id = p.seller_id
      ORDER BY views DESC, orders DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    ) x
  ), '[]'::jsonb);
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
        lower(btrim(s.search_term)) AS search_term,
        count(*)::integer AS searches,
        count(DISTINCT s.user_id)::integer AS unique_users,
        bool_and(COALESCE(s.results_count, 0) = 0) AS no_results
      FROM public.search_demand_log s
      WHERE s.searched_at >= now() - interval '30 days'
        AND length(btrim(COALESCE(s.search_term, ''))) >= 2
      GROUP BY 1
      ORDER BY unique_users DESC, searches DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_search_people(p_term text)
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
  IF length(btrim(COALESCE(p_term, ''))) < 2 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x))
    FROM (
      SELECT
        pr.name,
        pr.phone,
        s.searched_at,
        COALESCE(s.results_count, 0) AS results_count,
        (
          SELECT d.platform FROM public.device_tokens d
          WHERE d.user_id = s.user_id
          ORDER BY d.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS platform
      FROM public.search_demand_log s
      JOIN public.profiles pr ON pr.id = s.user_id
      WHERE lower(btrim(s.search_term)) = lower(btrim(p_term))
        AND s.searched_at >= now() - interval '30 days'
      ORDER BY s.searched_at DESC
      LIMIT 50
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_seller_acquisition()
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
        pr.name,
        pr.phone,
        COALESCE(sp.business_name, '') AS store_name,
        COALESCE(a.platform, '') AS platform,
        a.last_active_at,
        CASE
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
        END AS stage,
        a.abandoned_stage
      FROM public.seller_onboarding_attempts a
      JOIN public.profiles pr ON pr.id = a.user_id
      LEFT JOIN public.seller_profiles sp ON sp.id = a.store_id
      ORDER BY a.last_active_at DESC
      LIMIT 100
    ) x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_active_since_yesterday()
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
        pr.name,
        pr.phone,
        (
          SELECT d.platform FROM public.device_tokens d
          WHERE d.user_id = f.user_id
          ORDER BY d.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS platform,
        string_agg(DISTINCT f.activity, ', ' ORDER BY f.activity) AS actions
      FROM (
        SELECT v.viewer_id AS user_id, 'viewed a product'::text AS activity
        FROM public.product_views v
        WHERE v.viewer_id IS NOT NULL AND v.viewed_at >= now() - interval '1 day'
        UNION ALL
        SELECT c.user_id, 'added to cart'
        FROM public.cart_add_log c
        WHERE c.created_at >= now() - interval '1 day'
        UNION ALL
        SELECT s.user_id, 'searched ' || lower(btrim(s.search_term))
        FROM public.search_demand_log s
        WHERE s.user_id IS NOT NULL AND s.searched_at >= now() - interval '1 day'
        UNION ALL
        SELECT o.buyer_id, 'placed an order'
        FROM public.orders o
        WHERE o.created_at >= now() - interval '1 day'
        UNION ALL
        SELECT a.user_id, 'onboarding ' || a.current_stage
        FROM public.seller_onboarding_attempts a
        WHERE a.last_active_at >= now() - interval '1 day'
      ) f
      JOIN public.profiles pr ON pr.id = f.user_id
      GROUP BY pr.name, pr.phone, f.user_id
      ORDER BY pr.name
      LIMIT 80
    ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.log_product_view_daily(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_cart_add(uuid, uuid, numeric, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_seller_onboarding_attempt(text, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seller_store_insights(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_market_overview(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_product_demand(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_search_intelligence(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_search_people(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_seller_acquisition() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_active_since_yesterday() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.log_product_view_daily(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_cart_add(uuid, uuid, numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_seller_onboarding_attempt(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seller_store_insights(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_market_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_product_demand(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_intelligence(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_people(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seller_acquisition() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_active_since_yesterday() TO authenticated;

GRANT INSERT ON public.cart_add_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.seller_onboarding_attempts TO authenticated;

INSERT INTO public.seller_onboarding_attempts (
  user_id, store_id, current_stage, started_at, last_active_at, completed_at, source
)
SELECT DISTINCT ON (sp.user_id)
  sp.user_id,
  sp.id,
  CASE
    WHEN sp.business_name ILIKE '[HOLD]%' THEN 'hold'
    WHEN sp.business_name ILIKE '[ARCHIVED]%' THEN 'archived'
    WHEN sp.verification_status = 'approved' AND COALESCE(sp.is_available, false) THEN 'live'
    WHEN sp.verification_status = 'approved' THEN 'approved'
    WHEN sp.verification_status = 'rejected' THEN 'rejected'
    WHEN sp.verification_status = 'pending' THEN 'submitted'
    ELSE 'store_details'
  END,
  COALESCE(sp.created_at, now()),
  COALESCE(sp.updated_at, sp.created_at, now()),
  CASE
    WHEN sp.verification_status IN ('approved', 'pending', 'rejected') THEN COALESCE(sp.updated_at, now())
    ELSE NULL
  END,
  'existing_store'
FROM public.seller_profiles sp
WHERE sp.user_id IS NOT NULL
ORDER BY sp.user_id, sp.updated_at DESC NULLS LAST
ON CONFLICT (user_id) DO NOTHING;
