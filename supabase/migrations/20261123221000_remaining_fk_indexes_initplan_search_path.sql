-- Remaining unindexed FK covering indexes, RLS initplan wrap, missing search_path.
-- Index creation is IF NOT EXISTS. Initplan rewrite only wraps auth.uid()/auth.jwt()
-- into (select ...) and keeps roles/cmd/qual otherwise identical.

-- 1. Covering indexes for leftover public foreign keys
DO $$
DECLARE
  r record;
  col text;
  idx text;
  rel text;
BEGIN
  FOR r IN
    SELECT c.conrelid, c.conkey, rel.relname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND (i.indkey::smallint[])[0] = c.conkey[1]
      )
  LOOP
    SELECT a.attname INTO col
    FROM pg_attribute a
    WHERE a.attrelid = r.conrelid AND a.attnum = r.conkey[1];

    rel := r.relname;
    idx := left('idx_' || rel || '_' || col, 63);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
      idx, rel, col
    );
  END LOOP;
END $$;

-- 2. Wrap auth.uid()/auth.jwt() for initplan on public policies
CREATE OR REPLACE FUNCTION public.sociva_wrap_initplan_expr(p_expr text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public
AS $$
DECLARE
  v text := p_expr;
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  v := replace(v, '( SELECT auth.uid() AS uid)', '(select auth.uid())');
  v := replace(v, '( SELECT auth.uid())', '(select auth.uid())');
  v := replace(v, '(select auth.uid())', '___SOCIVA_UID___');
  v := replace(v, '( SELECT auth.jwt() AS jwt)', '(select auth.jwt())');
  v := replace(v, '( SELECT auth.jwt())', '(select auth.jwt())');
  v := replace(v, '(select auth.jwt())', '___SOCIVA_JWT___');
  v := replace(v, 'auth.uid()', '(select auth.uid())');
  v := replace(v, 'auth.jwt()', '(select auth.jwt())');
  v := replace(v, '___SOCIVA_UID___', '(select auth.uid())');
  v := replace(v, '___SOCIVA_JWT___', '(select auth.jwt())');
  RETURN v;
END;
$$;

DO $$
DECLARE
  pol record;
  new_using text;
  new_check text;
  role_sql text;
  perm text;
  using_sql text;
  check_sql text;
BEGIN
  FOR pol IN
    SELECT
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') ~ 'auth\.(uid|jwt)\('
        OR COALESCE(with_check, '') ~ 'auth\.(uid|jwt)\('
      )
  LOOP
    new_using := public.sociva_wrap_initplan_expr(pol.qual);
    new_check := public.sociva_wrap_initplan_expr(pol.with_check);

    IF new_using IS NOT DISTINCT FROM pol.qual
       AND new_check IS NOT DISTINCT FROM pol.with_check THEN
      CONTINUE;
    END IF;

    IF pol.roles IS NULL OR array_length(pol.roles, 1) IS NULL THEN
      role_sql := 'public';
    ELSE
      role_sql := (
        SELECT string_agg(quote_ident(x), ', ')
        FROM unnest(pol.roles) AS x
      );
    END IF;

    perm := CASE
      WHEN pol.permissive = 'RESTRICTIVE' THEN 'RESTRICTIVE'
      ELSE 'PERMISSIVE'
    END;

    using_sql := CASE WHEN new_using IS NOT NULL THEN format(' USING (%s)', new_using) ELSE '' END;
    check_sql := CASE WHEN new_check IS NOT NULL THEN format(' WITH CHECK (%s)', new_check) ELSE '' END;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s%s%s',
      pol.policyname,
      pol.tablename,
      perm,
      pol.cmd,
      role_sql,
      using_sql,
      check_sql
    );
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.sociva_wrap_initplan_expr(text);

-- 3. Pin search_path on leftover public DEFINER functions
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
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'
        )
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
      r.proname,
      r.args
    );
  END LOOP;
END $$;

-- 4. Revoke trigger/internal DEFINER RPCs not used by the SPA
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
      AND has_function_privilege('authenticated', p.oid, 'execute')
      AND p.proname IN (
        'cleaner_city_append_ride_event',
        'voip_append_event',
        'notify_eligible_sellers_festival_published',
        'cleaner_city_apply_fuel_snapshot',
        'cleaner_city_notify_waitlist_for_publication'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname,
      r.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      r.proname,
      r.args
    );
  END LOOP;
END $$;
