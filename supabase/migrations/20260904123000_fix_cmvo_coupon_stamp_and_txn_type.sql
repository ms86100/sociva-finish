-- BUG-10: stamp seller_delivery / self_fulfillment (not always cart_purchase from add_to_cart map)
-- BUG-12: stamp orders.coupon_id + discount_amount when coupon redeemed
-- Also backfill recent mis-stamps from redemptions / heal helper.

DO $do$
DECLARE
  def text;
  norm text;
  old_stamp text;
  new_stamp text;
  old_insert_cols text;
  new_insert_cols text;
  old_insert_vals text;
  new_insert_vals text;
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

  norm := replace(def, E'\r\n', E'\n');

  -- ---- BUG-10: fulfillment-aware transaction_type ----
  IF position('resolve_cart_order_transaction_type' in norm) = 0 THEN
    old_stamp := $b$
    SELECT atm.transaction_type INTO _resolved_tx_type
    FROM public.action_type_workflow_map atm
    WHERE atm.action_type = 'add_to_cart'
    LIMIT 1;
$b$;

    new_stamp := $b$
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

    IF position(trim(both E'\n' from old_stamp) in norm) = 0 THEN
      RAISE EXCEPTION 'CMVO stamp block (add_to_cart map) not found — inspect live definition';
    END IF;

    norm := replace(norm, trim(both E'\n' from old_stamp), trim(both E'\n' from new_stamp));
  END IF;

  -- ---- BUG-12: coupon_id + discount_amount on insert ----
  IF position('discount_amount, coupon_id' in norm) = 0
     AND position('coupon_id, discount_amount' in norm) = 0 THEN
    old_insert_cols := $b$
      payment_type, payment_status, delivery_fee, coupon_discount,
      idempotency_key, delivery_handled_by, auto_cancel_at,
$b$;

    new_insert_cols := $b$
      payment_type, payment_status, delivery_fee, coupon_discount, discount_amount, coupon_id,
      idempotency_key, delivery_handled_by, auto_cancel_at,
$b$;

    IF position(trim(both E'\n' from old_insert_cols) in norm) = 0 THEN
      RAISE EXCEPTION 'CMVO insert coupon_discount column list not found';
    END IF;

    norm := replace(norm, trim(both E'\n' from old_insert_cols), trim(both E'\n' from new_insert_cols));

    old_insert_vals := $b$
      case when _group_count = 1 then _delivery_fee else 0 end,
      case when _group_count = 1 then _coupon_discount else 0 end,
      _row_idempotency_key, _delivery_handled_by, _auto_cancel_at,
$b$;

    new_insert_vals := $b$
      case when _group_count = 1 then _delivery_fee else 0 end,
      case when _group_count = 1 then _coupon_discount else 0 end,
      case when _group_count = 1 then coalesce(_coupon_discount, 0) else 0 end,
      case when _group_count = 1 then _resolved_coupon_id else null end,
      _row_idempotency_key, _delivery_handled_by, _auto_cancel_at,
$b$;

    IF position(trim(both E'\n' from old_insert_vals) in norm) = 0 THEN
      RAISE EXCEPTION 'CMVO insert coupon_discount values not found';
    END IF;

    norm := replace(norm, trim(both E'\n' from old_insert_vals), trim(both E'\n' from new_insert_vals));
  END IF;

  IF position('resolve_cart_order_transaction_type' in norm) = 0 THEN
    RAISE EXCEPTION 'BUG-10 patch failed: resolve_cart_order_transaction_type still missing';
  END IF;

  IF position('discount_amount, coupon_id' in norm) = 0
     AND position('coupon_id, discount_amount' in norm) = 0 THEN
    RAISE EXCEPTION 'BUG-12 patch failed: coupon_id/discount_amount still missing from insert';
  END IF;

  EXECUTE norm;
END;
$do$;

-- Backfill coupon stamps from redemptions where order total already reflected discount
UPDATE public.orders o
SET
  coupon_id = cr.coupon_id,
  discount_amount = COALESCE(NULLIF(cr.discount_applied, 0), NULLIF(o.coupon_discount, 0), 0),
  coupon_discount = GREATEST(COALESCE(o.coupon_discount, 0), COALESCE(cr.discount_applied, 0)),
  updated_at = now()
FROM public.coupon_redemptions cr
WHERE cr.order_id = o.id
  AND (
    o.coupon_id IS NULL
    OR COALESCE(o.discount_amount, 0) = 0
  );

-- Backfill wrong cart_purchase stamps on seller delivery / pickup
UPDATE public.orders o
SET
  transaction_type = public.heal_order_transaction_type(
    o.transaction_type,
    o.fulfillment_type,
    o.delivery_handled_by
  ),
  updated_at = now()
WHERE o.order_type = 'purchase'
  AND o.transaction_type IS DISTINCT FROM public.heal_order_transaction_type(
        o.transaction_type,
        o.fulfillment_type,
        o.delivery_handled_by
      );
