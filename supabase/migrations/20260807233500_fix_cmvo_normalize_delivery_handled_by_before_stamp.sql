-- Ensure CMVO normalizes delivery_handled_by from seller fulfillment_mode
-- before resolve_cart_order_transaction_type (authoritative 20260403164346).
DO $do$
DECLARE
  def text;
  old_block text;
  new_block text;
  norm text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
  ORDER BY CASE WHEN pg_get_function_identity_arguments(p.oid) LIKE '%_loyalty_points%' THEN 0 ELSE 1 END
  LIMIT 1;

  IF def IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  IF position('_seller_fulfillment_mode IN' in def) > 0
     AND position('resolve_cart_order_transaction_type' in def) > 0 THEN
    RAISE NOTICE 'CMVO already normalizes delivery_handled_by; skipping';
    RETURN;
  END IF;

  norm := replace(def, E'\r\n', E'\n');

  old_block := $b$
    -- Fulfillment-aware workflow stamp (seller delivery / pickup / platform)
    _resolved_tx_type := public.resolve_cart_order_transaction_type(
      _fulfillment_type,
      _delivery_handled_by
    );
$b$;

  IF position(trim(both E'\n' from old_block) in norm) = 0 THEN
    old_block := $b$
    _resolved_tx_type := public.resolve_cart_order_transaction_type(
      _fulfillment_type,
      _delivery_handled_by
    );
$b$;
  END IF;

  new_block := $b$
    IF _fulfillment_type = 'self_pickup' THEN
      _delivery_handled_by := NULL;
    ELSIF _fulfillment_type = 'delivery' THEN
      IF _seller_fulfillment_mode IN ('seller_delivery', 'pickup_and_seller_delivery') THEN
        _delivery_handled_by := 'seller';
      ELSIF _seller_fulfillment_mode IN ('platform_delivery', 'pickup_and_platform_delivery') THEN
        _delivery_handled_by := 'platform';
      ELSIF _delivery_handled_by IS NULL THEN
        _delivery_handled_by := 'seller';
      END IF;
    END IF;

    _resolved_tx_type := public.resolve_cart_order_transaction_type(
      _fulfillment_type,
      _delivery_handled_by
    );
$b$;

  IF position(trim(both E'\n' from old_block) in norm) = 0 THEN
    RAISE EXCEPTION 'Existing resolve_cart stamp block not found in create_multi_vendor_orders';
  END IF;

  norm := replace(norm, trim(both E'\n' from old_block), trim(both E'\n' from new_block));
  EXECUTE norm;
END;
$do$;
