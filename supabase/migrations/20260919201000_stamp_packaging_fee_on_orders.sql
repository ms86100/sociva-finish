-- Stamp seller_profiles.packaging_fee onto orders once per seller group.
-- Packaging sits outside the coupon/loyalty item base, same as delivery_fee.

DO $$
DECLARE
  src text;
  oid oid;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO oid, src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_multi_vendor_orders'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF src IS NULL THEN
    RAISE EXCEPTION 'create_multi_vendor_orders not found';
  END IF;

  IF src LIKE '%_packaging_fee numeric%' THEN
    RAISE NOTICE 'create_multi_vendor_orders already stamps packaging_fee';
  ELSE
    IF position('_created_count int;' IN src) = 0 THEN
      RAISE EXCEPTION 'declare anchor not found on create_multi_vendor_orders';
    END IF;
    src := replace(src,
      '_created_count int;',
      '_created_count int;
  _packaging_fee numeric := 0;');

    IF position('sp.fulfillment_mode, sp.delivery_handled_by,' IN src) = 0 THEN
      RAISE EXCEPTION 'seller select anchor not found on create_multi_vendor_orders';
    END IF;
    src := replace(src,
      'sp.fulfillment_mode, sp.delivery_handled_by,
           case
             when _fulfillment_type = ''self_pickup'' then sp.pickup_payment_config
             else sp.delivery_payment_config
           end
    into _seller_user_id, _seller_name, _seller_society_id, _seller_status,
         _seller_lat, _seller_lng, _seller_radius,
         _seller_fulfillment_mode, _delivery_handled_by,
         _seller_payment_config',
      'sp.fulfillment_mode, sp.delivery_handled_by,
           GREATEST(COALESCE(sp.packaging_fee, 0), 0),
           case
             when _fulfillment_type = ''self_pickup'' then sp.pickup_payment_config
             else sp.delivery_payment_config
           end
    into _seller_user_id, _seller_name, _seller_society_id, _seller_status,
         _seller_lat, _seller_lng, _seller_radius,
         _seller_fulfillment_mode, _delivery_handled_by,
         _packaging_fee,
         _seller_payment_config');

    IF position('payment_type, payment_status, delivery_fee, coupon_discount, discount_amount, coupon_id,' IN src) = 0 THEN
      RAISE EXCEPTION 'insert column anchor not found on create_multi_vendor_orders';
    END IF;
    src := replace(src,
      'payment_type, payment_status, delivery_fee, coupon_discount, discount_amount, coupon_id,',
      'payment_type, payment_status, delivery_fee, packaging_fee, coupon_discount, discount_amount, coupon_id,');

    IF position('case when _group_count = 1 then _delivery_fee else 0 end,
      case when _group_count = 1 then _coupon_discount else 0 end,' IN src) = 0 THEN
      RAISE EXCEPTION 'insert values anchor not found on create_multi_vendor_orders';
    END IF;
    src := replace(src,
      'case when _group_count = 1 then _delivery_fee else 0 end,
      case when _group_count = 1 then _coupon_discount else 0 end,',
      'case when _group_count = 1 then _delivery_fee else 0 end,
      coalesce(_packaging_fee, 0),
      case when _group_count = 1 then _coupon_discount else 0 end,');

    IF position('+ (case when _group_count = 1 then _delivery_fee else 0 end)
        - (case when _group_count = 1 then _coupon_discount else 0 end)' IN src) = 0 THEN
      RAISE EXCEPTION 'total_amount anchor not found on create_multi_vendor_orders';
    END IF;
    src := replace(src,
      '+ (case when _group_count = 1 then _delivery_fee else 0 end)
        - (case when _group_count = 1 then _coupon_discount else 0 end)',
      '+ (case when _group_count = 1 then _delivery_fee else 0 end)
        + coalesce(_packaging_fee, 0)
        - (case when _group_count = 1 then _coupon_discount else 0 end)');

    EXECUTE src;
  END IF;
END $$;

-- Loyalty quote base excludes packaging the same way it excludes delivery.
DO $$
DECLARE
  src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'quote_loyalty_redemption'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF src IS NULL THEN
    RAISE NOTICE 'quote_loyalty_redemption not found - skip packaging subtraction';
    RETURN;
  END IF;

  IF src LIKE '%packaging_fee%' THEN
    RAISE NOTICE 'quote_loyalty_redemption already excludes packaging_fee';
    RETURN;
  END IF;

  IF position('GREATEST(o.total_amount - o.delivery_fee, 0)' IN src) = 0 THEN
    RAISE NOTICE 'loyalty quote base pattern not found - skip';
    RETURN;
  END IF;

  src := replace(src,
    'GREATEST(o.total_amount - o.delivery_fee, 0)',
    'GREATEST(o.total_amount - COALESCE(o.delivery_fee, 0) - COALESCE(o.packaging_fee, 0), 0)');
  EXECUTE src;
END $$;
