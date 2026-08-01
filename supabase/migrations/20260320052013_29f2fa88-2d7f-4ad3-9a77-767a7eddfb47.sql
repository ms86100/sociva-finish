
-- Drop the 14-param overload (from quick-reorder edge function)
DROP FUNCTION public.create_multi_vendor_orders(uuid, json, text, text, text, text, text, uuid, double precision, double precision, numeric, text, numeric, text);

-- Drop the 16-param overload (missing idempotency_key, uses double precision for lat/lng)
DROP FUNCTION public.create_multi_vendor_orders(uuid, json, text, text, text, text, numeric, text, text, numeric, boolean, numeric, text, uuid, double precision, double precision);
