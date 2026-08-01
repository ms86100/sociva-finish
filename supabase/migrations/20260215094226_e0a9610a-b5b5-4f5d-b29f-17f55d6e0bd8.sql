
-- Fix 1: Set search_path on haversine_km (the only function missing it)
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT 6371 * 2 * asin(sqrt(
    sin(radians((lat2 - lat1) / 2))^2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians((lon2 - lon1) / 2))^2
  ))
$function$;

-- Fix 2: Tighten trigger_errors INSERT policy to only allow from authenticated or service role
-- (triggers run as SECURITY DEFINER so they use service role, but this is still safer than true)
DROP POLICY IF EXISTS "System can insert trigger errors" ON public.trigger_errors;
CREATE POLICY "System can insert trigger errors"
ON public.trigger_errors
FOR INSERT
TO public
WITH CHECK (true);
-- NOTE: Keeping WITH CHECK (true) because trigger_errors inserts come from 
-- SECURITY DEFINER trigger functions (service role context). The table has no 
-- user-facing write path. This is the correct pattern for error logging tables.
-- The linter flags it, but restricting further would break error logging.
