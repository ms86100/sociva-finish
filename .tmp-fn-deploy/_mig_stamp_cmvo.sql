-- Patch create_multi_vendor_orders stamp: fulfillment-aware (not always cart_purchase)
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
    AND pg_get_function_identity_arguments(p.oid) LIKE '%_loyalty_points%'
  LIMIT 1;

  IF def IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders overload not found';
  END IF;

  norm := replace(def, E'\r\n', E'\n');

  old_block := $b$
    SELECT atm.transaction_type INTO _resolved_tx_type
    FROM public.action_type_workflow_map atm
    WHERE atm.action_type = 'add_to_cart'
    LIMIT 1;
$b$;

  new_block := $b$
    -- Fulfillment-aware workflow stamp (seller delivery / pickup / platform)
    _resolved_tx_type := public.resolve_cart_order_transaction_type(
      _fulfillment_type,
      _delivery_handled_by
    );
$b$;

  IF position(trim(both E'\n' from old_block) in norm) = 0 THEN
    RAISE EXCEPTION 'Stamp block not found in create_multi_vendor_orders';
  END IF;

  norm := replace(norm, trim(both E'\n' from old_block), trim(both E'\n' from new_block));

  IF position('resolve_cart_order_transaction_type' in norm) = 0 THEN
    RAISE EXCEPTION 'Failed to patch create_multi_vendor_orders stamp block';
  END IF;

  EXECUTE norm;
END;
$do$;
