-- The 4-argument get_products_for_sellers overload returned approved products
-- without credit, radius, or buyer-location checks. Drop it so all callers
-- must use the 6-argument version, which defaults missing coordinates to NULL
-- and therefore fails seller_is_discoverable_to_buyer.
DROP FUNCTION IF EXISTS public.get_products_for_sellers(uuid[], text, integer, integer);
