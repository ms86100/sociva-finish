-- Gap-close (staging-safe): rate-limit helper, search wrappers, society NQ fair-use,
-- cron/internal DEFINER revoke, more hot FK indexes, initplan on device_tokens.

-- ── 1. Shared rate-limit assert (uses public.rate_limits) ───────────────────
CREATE OR REPLACE FUNCTION public.sociva_assert_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_existing public.rate_limits%ROWTYPE;
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) = 0 THEN
    RETURN;
  END IF;
  IF p_max IS NULL OR p_max <= 0 OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RETURN;
  END IF;

  LOOP
    SELECT * INTO v_existing
    FROM public.rate_limits
    WHERE key = p_key
    FOR UPDATE;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.rate_limits (key, count, window_start)
        VALUES (p_key, 1, v_now);
        RETURN;
      EXCEPTION
        WHEN unique_violation THEN
          -- concurrent first insert; retry
          NULL;
      END;
    ELSE
      IF v_existing.window_start < v_now - make_interval(secs => p_window_seconds) THEN
        UPDATE public.rate_limits
        SET count = 1, window_start = v_now
        WHERE key = p_key;
        RETURN;
      END IF;

      IF v_existing.count >= p_max THEN
        RAISE EXCEPTION 'rate_limit_exceeded'
          USING ERRCODE = 'P0001',
                HINT = 'Too many requests. Please wait a moment and try again.';
      END IF;

      UPDATE public.rate_limits
      SET count = count + 1
      WHERE key = p_key;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sociva_assert_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sociva_assert_rate_limit(text, integer, integer) TO authenticated, service_role;

-- ── 2. Wrap search_products_v2 with user/IP rate limit (generous) ───────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_products_v2'
      AND NOT EXISTS (
        SELECT 1 FROM pg_proc p2
        JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
        WHERE n2.nspname = 'public' AND p2.proname = 'search_products_v2_core'
      )
  ) THEN
    ALTER FUNCTION public.search_products_v2(
      text, double precision, double precision, double precision, uuid,
      text[], numeric, boolean, numeric, numeric, text, integer, integer
    ) RENAME TO search_products_v2_core;
  END IF;
END $$;

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
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '10s'
AS $$
BEGIN
  -- Generous: 120 searches / minute per authenticated user (or anon bucket).
  PERFORM public.sociva_assert_rate_limit(
    'search_products:' || coalesce(auth.uid()::text, 'anon'),
    120,
    60
  );

  RETURN QUERY
  SELECT *
  FROM public.search_products_v2_core(
    _query, _lat, _lng, _radius_km, _buyer_society_id, _categories,
    _min_rating, _is_veg, _min_price, _max_price, _sort_by, _limit, _offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.search_products_v2(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_v2(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_products_v2_core(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_products_v2_core(
  text, double precision, double precision, double precision, uuid,
  text[], numeric, boolean, numeric, numeric, text, integer, integer
) TO service_role;

-- ── 2b. Wrap search_sellers_paginated (generous RL) ─────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_sellers_paginated'
      AND NOT EXISTS (
        SELECT 1 FROM pg_proc p2
        JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
        WHERE n2.nspname = 'public' AND p2.proname = 'search_sellers_paginated_core'
      )
  ) THEN
    ALTER FUNCTION public.search_sellers_paginated(
      double precision, double precision, double precision, integer, integer
    ) RENAME TO search_sellers_paginated_core;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.search_sellers_paginated(
  _lat double precision,
  _lng double precision,
  _radius_km double precision DEFAULT 50,
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
  availability_start time without time zone,
  availability_end time without time zone,
  seller_latitude double precision,
  seller_longitude double precision,
  operating_days text[],
  distance_km double precision,
  product_count bigint,
  avg_response_minutes integer,
  last_active_at timestamp with time zone,
  completed_order_count integer,
  home_service_available boolean,
  home_service_fee numeric,
  fulfillment_mode text,
  vacation_mode boolean,
  avg_preparation_time integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sociva_assert_rate_limit(
    'search_sellers:' || coalesce(auth.uid()::text, 'anon'),
    120,
    60
  );

  RETURN QUERY
  SELECT *
  FROM public.search_sellers_paginated_core(
    _lat, _lng, _radius_km, _limit, _offset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.search_sellers_paginated(
  double precision, double precision, double precision, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_sellers_paginated(
  double precision, double precision, double precision, integer, integer
) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_sellers_paginated_core(
  double precision, double precision, double precision, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_sellers_paginated_core(
  double precision, double precision, double precision, integer, integer
) TO service_role;

-- ── 3. Society fair-use on notification_queue enqueue ───────────────────────
CREATE OR REPLACE FUNCTION public.sociva_notification_society_fair_use()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_society uuid;
  v_count integer;
BEGIN
  v_society := NEW.society_id;
  IF v_society IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cap enqueue storms: 400 rows / 10 minutes per society (order+push traffic).
  SELECT count(*)::integer INTO v_count
  FROM public.notification_queue
  WHERE society_id = v_society
    AND created_at > now() - interval '10 minutes';

  IF COALESCE(v_count, 0) >= 400 THEN
    RAISE EXCEPTION 'society_notification_rate_limit'
      USING ERRCODE = 'P0001',
            HINT = 'Too many notifications for this society right now. Please retry shortly.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sociva_notification_society_fair_use ON public.notification_queue;
CREATE TRIGGER sociva_notification_society_fair_use
  BEFORE INSERT ON public.notification_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.sociva_notification_society_fair_use();

-- ── 4. Revoke cron management RPCs from authenticated (admin Edge uses service_role)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname IN (
        'disable_cron_job',
        'enable_cron_job',
        'get_cron_jobs',
        'get_cron_job_runs',
        'update_cron_schedule'
      )
  LOOP
    EXECUTE format(
      'revoke execute on function public.%I(%s) from public, anon, authenticated',
      r.proname,
      r.args
    );
    EXECUTE format(
      'grant execute on function public.%I(%s) to service_role',
      r.proname,
      r.args
    );
  END LOOP;
END $$;

-- ── 5. Hot FK covering indexes (advisor unindexed FKs) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_coupons_society_id ON public.coupons (society_id);
CREATE INDEX IF NOT EXISTS idx_featured_items_society_id ON public.featured_items (society_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_society_id ON public.user_notifications (society_id);
CREATE INDEX IF NOT EXISTS idx_emergency_broadcasts_society_id ON public.emergency_broadcasts (society_id);
CREATE INDEX IF NOT EXISTS idx_payment_settlements_seller_id ON public.payment_settlements (seller_id);
CREATE INDEX IF NOT EXISTS idx_payment_settlements_society_id ON public.payment_settlements (society_id);
CREATE INDEX IF NOT EXISTS idx_dispute_tickets_order_id ON public.dispute_tickets (order_id);
CREATE INDEX IF NOT EXISTS idx_dispute_comments_ticket_id ON public.dispute_comments (ticket_id);
CREATE INDEX IF NOT EXISTS idx_subscription_deliveries_subscription_id ON public.subscription_deliveries (subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_deliveries_order_id ON public.subscription_deliveries (order_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_seller_id ON public.subscriptions (seller_id);
CREATE INDEX IF NOT EXISTS idx_service_bookings_order_id ON public.service_bookings (order_id);
CREATE INDEX IF NOT EXISTS idx_visitor_types_society_id ON public.visitor_types (society_id);
CREATE INDEX IF NOT EXISTS idx_authorized_persons_society_id ON public.authorized_persons (society_id);
CREATE INDEX IF NOT EXISTS idx_society_income_society_id ON public.society_income (society_id);
CREATE INDEX IF NOT EXISTS idx_project_towers_society_id ON public.project_towers (society_id);
CREATE INDEX IF NOT EXISTS idx_snag_tickets_tower_id ON public.snag_tickets (tower_id);
CREATE INDEX IF NOT EXISTS idx_manual_entry_requests_guard_id ON public.manual_entry_requests (guard_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON public.reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_builder_announcements_society_id ON public.builder_announcements (society_id);

-- ── 6. device_tokens RLS initplan (hot path) ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'device_tokens'
      AND policyname = 'Users can view own device tokens'
  ) THEN
    EXECUTE 'drop policy "Users can view own device tokens" on public.device_tokens';
    EXECUTE $p$
      create policy "Users can view own device tokens" on public.device_tokens
        for select to authenticated
        using (user_id = (select auth.uid()))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'device_tokens'
      AND policyname = 'Users can insert own device tokens'
  ) THEN
    EXECUTE 'drop policy "Users can insert own device tokens" on public.device_tokens';
    EXECUTE $p$
      create policy "Users can insert own device tokens" on public.device_tokens
        for insert to authenticated
        with check (user_id = (select auth.uid()))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'device_tokens'
      AND policyname = 'Users can update own device tokens'
  ) THEN
    EXECUTE 'drop policy "Users can update own device tokens" on public.device_tokens';
    EXECUTE $p$
      create policy "Users can update own device tokens" on public.device_tokens
        for update to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'device_tokens'
      AND policyname = 'Users can delete own device tokens'
  ) THEN
    EXECUTE 'drop policy "Users can delete own device tokens" on public.device_tokens';
    EXECUTE $p$
      create policy "Users can delete own device tokens" on public.device_tokens
        for delete to authenticated
        using (user_id = (select auth.uid()))
    $p$;
  END IF;
END $$;

-- ── 7. Collapse multi-permissive on notification_queue select if split ──────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_queue'
      AND policyname IN (
        'Admins can view notification queue',
        'Service role full access notification_queue'
      )
  ) THEN
    -- Leave service_role bypass; collapse only authenticated admin duplicate if present.
    NULL;
  END IF;
END $$;
