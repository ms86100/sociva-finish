-- Staging only: profiles SELECT policy calls seller_has_order_with_buyer.
-- EXECUTE was revoked from authenticated during hardening, so the admin Users
-- directory 403'd with permission denied for function seller_has_order_with_buyer.

GRANT EXECUTE ON FUNCTION public.seller_has_order_with_buyer(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.seller_has_order_with_buyer(uuid) FROM PUBLIC, anon;
