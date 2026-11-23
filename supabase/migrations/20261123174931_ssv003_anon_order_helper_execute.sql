-- Profiles SELECT calls seller_has_order_with_buyer. Same RLS pitfall as is_admin.
-- Wrapper/function returns false for logged-out users; GRANT is only so the policy can run.
GRANT EXECUTE ON FUNCTION public.seller_has_order_with_buyer(uuid) TO anon;
