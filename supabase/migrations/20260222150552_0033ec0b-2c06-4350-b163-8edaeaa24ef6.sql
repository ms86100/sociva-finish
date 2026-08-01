
-- Fix A: Change is_feature_enabled_for_society to fail-closed (COALESCE false instead of true)
CREATE OR REPLACE FUNCTION public.is_feature_enabled_for_society(_society_id uuid, _feature_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT ef.is_enabled FROM public.get_effective_society_features(_society_id) ef WHERE ef.feature_key = _feature_key LIMIT 1),
    false
  )
$function$;
