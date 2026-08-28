-- Patch live create_multi_vendor_orders: block partial multi-seller checkout (idempotent).
DO $patch$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_multi_vendor_orders'
  LIMIT 1;

  IF def IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  IF def LIKE '%partial_checkout_blocked%' THEN
    RAISE NOTICE 'create_multi_vendor_orders already has partial checkout guard';
    RETURN;
  END IF;

  IF position(E'  _wallet_result jsonb;\nbegin' in def) = 0 THEN
    RAISE EXCEPTION 'declare anchor not found on create_multi_vendor_orders';
  END IF;

  def := replace(
    def,
    E'  _wallet_result jsonb;\nbegin',
    E'  _wallet_result jsonb;\n  _skipped_sellers text[] := ''{}'';\n  _created_count int;\nbegin'
  );

  IF position(E'  end loop;\n\n  -- Stock decrement deferred until orders are confirmed successful.\n\n  if _resolved_coupon_id is not null and _first_order_id is not null then' in def) = 0 THEN
    RAISE EXCEPTION 'post-loop anchor not found on create_multi_vendor_orders';
  END IF;

  def := replace(
    def,
    E'  end loop;\n\n  -- Stock decrement deferred until orders are confirmed successful.\n\n  if _resolved_coupon_id is not null and _first_order_id is not null then',
    E'  end loop;\n\n  _created_count := coalesce(array_length(_order_ids, 1), 0);\n\n  if _total_groups > 1 and _created_count > 0 and _created_count < _total_groups then\n    delete from public.orders where id = any(_order_ids);\n    _skipped_sellers := _closed_sellers || _out_of_range || _payment_blocked_sellers || _credit_blocked_sellers;\n    return json_build_object(\n      ''success'', false,\n      ''error'', ''partial_checkout_blocked'',\n      ''message'', ''Checkout cannot complete for all stores in your cart. Remove unavailable stores or order from each store separately.'',\n      ''skipped_sellers'', to_json(_skipped_sellers),\n      ''closed_sellers'', to_json(_closed_sellers),\n      ''out_of_range_sellers'', to_json(_out_of_range),\n      ''payment_blocked_sellers'', to_json(_payment_blocked_sellers),\n      ''credit_blocked_sellers'', to_json(_credit_blocked_sellers),\n      ''created_count'', _created_count,\n      ''total_groups'', _total_groups\n    );\n  end if;\n\n  -- Stock decrement deferred until orders are confirmed successful.\n\n  if _resolved_coupon_id is not null and _first_order_id is not null then'
  );

  def := replace(def, 'array_length(_order_ids, 1) = 0', '_created_count = 0');
  def := replace(def, 'array_length(_order_ids, 1) > 0', '_created_count > 0');

  EXECUTE def;
END
$patch$;
