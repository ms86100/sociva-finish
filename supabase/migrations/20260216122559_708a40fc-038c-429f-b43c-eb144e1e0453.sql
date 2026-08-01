-- Drop the old function signature that uses INTEGER for _radius_km
-- This resolves the PGRST203 overloading ambiguity
DROP FUNCTION IF EXISTS public.search_nearby_sellers(uuid, integer, text, text);
