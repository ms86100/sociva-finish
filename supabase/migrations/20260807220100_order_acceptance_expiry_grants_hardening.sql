-- Harden grants / search_path for acceptance-expiry helpers
CREATE OR REPLACE FUNCTION public._order_acceptance_cron_name(_order_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT 'oae_' || replace(_order_id::text, '-', ''); $$;

REVOKE ALL ON FUNCTION public._order_acceptance_cron_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._order_acceptance_timeout_seconds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_trg_schedule_order_acceptance_expiry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_trg_clear_order_acceptance_expiry() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._order_acceptance_cron_name(uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public._order_acceptance_timeout_seconds() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.fn_trg_schedule_order_acceptance_expiry() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.fn_trg_clear_order_acceptance_expiry() TO postgres, service_role;
