-- Staging only. Restores SPA grants that the GO-VM / RL wrap accidentally
-- dropped, and marks search_sellers_paginated VOLATILE because the wrapper
-- writes a rate-limit row (STABLE + FOR UPDATE fails in PostgREST read-only tx).

GRANT EXECUTE ON FUNCTION public.get_user_auth_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'search_products_v2_unscoped'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure);
  END LOOP;
END $$;

ALTER FUNCTION public.search_sellers_paginated(
  double precision, double precision, double precision, integer, integer
) VOLATILE;

ALTER FUNCTION public.search_products_v2(
  text, double precision, double precision, double precision, uuid, text[],
  numeric, boolean, numeric, numeric, text, integer, integer
) VOLATILE;

ALTER FUNCTION public.get_products_for_sellers(
  uuid[], text, integer, integer, double precision, double precision
) VOLATILE;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.provolatile = 's'
      AND pg_get_functiondef(p.oid) ILIKE '%sociva_assert_rate_limit%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s VOLATILE', r.oid::regprocedure);
  END LOOP;
END $$;
