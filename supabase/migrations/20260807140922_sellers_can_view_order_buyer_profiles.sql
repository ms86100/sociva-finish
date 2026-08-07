-- Sellers need buyer name/address/phone on order cards and order detail.
-- Existing profiles SELECT only allows verification_status = 'approved' (or self/admin).
-- Many active buyers remain 'pending', so the buyer embed resolves to null and the UI
-- falls back to "Customer". Allow sellers to read profiles of buyers they have orders with.

CREATE OR REPLACE FUNCTION public.seller_has_order_with_buyer(_buyer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.seller_profiles sp ON sp.id = o.seller_id
    WHERE o.buyer_id = _buyer_id
      AND sp.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.seller_has_order_with_buyer(uuid) IS
  'True when the current auth user owns a seller_profile that has at least one order with the given buyer.';

DROP POLICY IF EXISTS "Sellers can view buyer profiles for their orders" ON public.profiles;

CREATE POLICY "Sellers can view buyer profiles for their orders"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.seller_has_order_with_buyer(id));
