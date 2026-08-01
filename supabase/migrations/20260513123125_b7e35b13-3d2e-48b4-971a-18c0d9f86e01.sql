
DO $$
DECLARE
  r record;
  cnt int := 0;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND pg_get_function_result(p.oid) = 'trigger'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      r.schema_name, r.proname, r.args
    );
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'Revoked EXECUTE on % trigger functions', cnt;
END
$$;
