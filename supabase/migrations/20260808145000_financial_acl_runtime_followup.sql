BEGIN;

-- These governance/alert tables can predate the canonical finance migrations.
-- Reassert their ACLs after the complete wallet chain so table creation order
-- cannot leave PostgreSQL's owner-derived privileges exposed to client roles.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'financial_control_change_requests',
    'financial_adjustment_requests',
    'financial_alerts'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_table
      );
      EXECUTE format(
        'GRANT ALL ON TABLE public.%I TO service_role',
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
