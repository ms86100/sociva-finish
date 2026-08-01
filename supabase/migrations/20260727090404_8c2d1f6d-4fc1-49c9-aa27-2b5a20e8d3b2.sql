CREATE OR REPLACE FUNCTION public.get_app_bootstrap()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'system_settings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', ss.key, 'value', ss.value))
      FROM public.system_settings ss
      WHERE ss.key IS NOT NULL
    ), '[]'::jsonb),
    'admin_settings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', a.key, 'value', a.value))
      FROM public.admin_settings a
      WHERE a.is_active = true AND a.key IS NOT NULL
    ), '[]'::jsonb),
    'parent_groups', COALESCE((
      SELECT jsonb_agg(to_jsonb(pg_row) ORDER BY pg_row.sort_order NULLS LAST)
      FROM public.parent_groups pg_row
    ), '[]'::jsonb),
    'category_config', COALESCE((
      SELECT jsonb_agg(to_jsonb(cc) ORDER BY cc.display_order NULLS LAST)
      FROM public.category_config cc
      WHERE cc.is_active = true
    ), '[]'::jsonb),
    'badge_config', COALESCE((
      SELECT jsonb_agg(to_jsonb(bc) ORDER BY bc.priority ASC NULLS LAST)
      FROM public.badge_config bc
      WHERE bc.is_active = true
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_app_bootstrap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_bootstrap() TO anon;
GRANT EXECUTE ON FUNCTION public.get_app_bootstrap() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_bootstrap() TO service_role;