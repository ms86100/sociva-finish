-- Revoke anon EXECUTE on remaining public SECURITY DEFINER functions,
-- keeping a small whitelist needed for public browse / RLS helpers.

DO $$
DECLARE
  r record;
  keep text[] := ARRAY[
    'has_role',
    'is_admin',
    'is_society_admin',
    'is_seller',
    'is_verified_seller',
    'active_banners_for_society',
    'resolve_banner_products',
    'resolve_banner_section_products',
    'get_public_payment_mode',
    'financial_runtime_preflight',
    'fn_check_rate_limit',
    'current_user_society_ids',
    'user_in_society'
  ];
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'execute')
      AND NOT (p.proname = ANY (keep))
  LOOP
    EXECUTE format(
      'revoke execute on function public.%I(%s) from public, anon',
      r.proname,
      r.args
    );
  END LOOP;
END $$;
