
-- Drop the old overloads that conflict
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(uuid, json, text, text, text, text, numeric, text, text, numeric, boolean, numeric, text);
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(uuid, json, text, text, text, text, numeric, text, text, numeric, boolean, numeric, text, uuid, numeric, numeric);
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(uuid, json, text, text, text, numeric, text, uuid, numeric, numeric, numeric, text, numeric, text);
