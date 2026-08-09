CREATE OR REPLACE FUNCTION public.commit_wallet_for_orders(_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res_id uuid;
BEGIN
  IF _order_ids IS NULL OR coalesce(array_length(_order_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_orders');
  END IF;

  SELECT wallet_reservation_id INTO _res_id
  FROM public.orders
  WHERE id = ANY(_order_ids)
    AND wallet_reservation_id IS NOT NULL
  LIMIT 1;

  IF _res_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  RETURN public.commit_wallet_reservation(_res_id, _order_ids);
END;
$$;