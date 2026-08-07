-- Extend seller buyer-profile visibility to service bookings (same pending-profile gap).
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
  )
  OR EXISTS (
    SELECT 1
    FROM public.service_bookings sb
    JOIN public.seller_profiles sp ON sp.id = sb.seller_id
    WHERE sb.buyer_id = _buyer_id
      AND sp.user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.seller_has_order_with_buyer(uuid) IS
  'True when the current auth user owns a seller_profile that has an order or service booking with the given buyer.';
