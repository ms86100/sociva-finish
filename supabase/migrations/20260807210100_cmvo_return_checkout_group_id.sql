-- Convenience RPC: resolve checkout_group_id for one or more order ids (buyer-owned).
-- create_multi_vendor_orders itself is wired via trg_orders_assign_checkout_group
-- (BEFORE INSERT) so new checkouts always get a parent group without rewriting CMVO.

CREATE OR REPLACE FUNCTION public.get_checkout_group_id_for_orders(_order_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
DECLARE
  v_group_id uuid;
BEGIN
  IF _order_ids IS NULL OR array_length(_order_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT o.checkout_group_id
    INTO v_group_id
  FROM public.orders o
  WHERE o.id = ANY (_order_ids)
    AND o.buyer_id = auth.uid()
    AND o.checkout_group_id IS NOT NULL
  ORDER BY o.created_at
  LIMIT 1;

  RETURN v_group_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_checkout_group_id_for_orders(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_checkout_group_id_for_orders(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkout_group_id_for_orders(uuid[]) TO service_role;

COMMENT ON FUNCTION public.get_checkout_group_id_for_orders(uuid[]) IS
  'Returns checkout_group_id for buyer-owned orders created in one checkout.';
