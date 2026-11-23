-- Pin leftover helper search_path + merge same-role same-cmd permissive policies (OR-equivalent).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'validate_product_seller_category',
        'wallet_plan_spend',
        'write_audit_event',
        'order_settled_gmv',
        'seller_credit_health_for',
        'seller_credit_event_for_order',
        'seller_credit_customer_reason',
        'seller_credit_format_inr',
        'seller_credit_booking_when',
        'seller_credit_spend_override_on',
        'notification_copy_or_fallback',
        'wilson_upper_bound',
        'normalize_taxonomy_key',
        'cleaner_city_is_personal_or_disposable_domain',
        'cleaner_city_haversine_meters',
        'cleaner_city_estimate_detour_minutes',
        'cleaner_city_shl',
        'cleaner_city_lock_guest_booking',
        'cleaner_city_sync_contact_verification',
        'whatsapp_evolution_readiness_complete',
        'cleaner_city_match_reason_label',
        'cleaner_city_assert_publishable_polyline',
        'conversations_direct_pair_key'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
      r.proname,
      r.args
    );
  END LOOP;
END $$;

DO $$
DECLARE
  g record;
  pol record;
  quals text[];
  checks text[];
  role_sql text;
  using_sql text;
  check_sql text;
  merged_name text;
BEGIN
  FOR g IN
    SELECT tablename, cmd, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND permissive = 'PERMISSIVE'
    GROUP BY tablename, cmd, roles
    HAVING count(*) > 1
  LOOP
    quals := ARRAY[]::text[];
    checks := ARRAY[]::text[];

    FOR pol IN
      SELECT policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = g.tablename
        AND cmd = g.cmd
        AND roles = g.roles
        AND permissive = 'PERMISSIVE'
      ORDER BY policyname
    LOOP
      IF pol.qual IS NOT NULL THEN
        quals := quals || ('(' || pol.qual || ')');
      END IF;
      IF pol.with_check IS NOT NULL THEN
        checks := checks || ('(' || pol.with_check || ')');
      END IF;
    END LOOP;

    IF g.roles IS NULL OR array_length(g.roles, 1) IS NULL THEN
      role_sql := 'public';
    ELSE
      role_sql := (
        SELECT string_agg(quote_ident(x), ', ')
        FROM unnest(g.roles) AS x
      );
    END IF;

    merged_name := left('merged_' || g.tablename || '_' || lower(g.cmd), 63);

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = g.tablename
        AND cmd = g.cmd
        AND roles = g.roles
        AND permissive = 'PERMISSIVE'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, g.tablename);
    END LOOP;

    using_sql := CASE WHEN array_length(quals, 1) IS NOT NULL THEN format(' USING (%s)', array_to_string(quals, ' OR ')) ELSE '' END;
    check_sql := CASE WHEN array_length(checks, 1) IS NOT NULL THEN format(' WITH CHECK (%s)', array_to_string(checks, ' OR ')) ELSE '' END;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s%s%s',
      merged_name,
      g.tablename,
      g.cmd,
      role_sql,
      using_sql,
      check_sql
    );
  END LOOP;
END $$;
