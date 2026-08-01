-- Drop existing function first (required because we cannot remove parameter defaults)
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(uuid,text,text,text,text,uuid,text,numeric,numeric,boolean,jsonb,text,numeric);

-- DEFECT 1: Recreate with delivery_handled_by population
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid,
  _delivery_address text,
  _notes text,
  _payment_method text,
  _payment_status text,
  _coupon_id uuid,
  _coupon_code text,
  _coupon_discount numeric,
  _cart_total numeric,
  _has_urgent boolean,
  _seller_groups jsonb,
  _fulfillment_type text DEFAULT 'self_pickup',
  _delivery_fee numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _group jsonb;
  _item jsonb;
  _order_id uuid;
  _order_ids uuid[] := ARRAY[]::uuid[];
  _seller_id uuid;
  _subtotal numeric;
  _proportional_discount numeric;
  _final_amount numeric;
  _auto_cancel_at timestamptz;
  _idempotency text;
  _buyer_society uuid;
  _seller_society uuid;
  _distance numeric;
  _is_cross boolean;
  _buyer_lat numeric;
  _buyer_lon numeric;
  _seller_lat numeric;
  _seller_lon numeric;
  _order_items jsonb;
  _first_order boolean := true;
  _platform_fee_pct numeric;
  _platform_fee numeric;
  _net_amount numeric;
  _delivery_handled_by text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _buyer_id) THEN
    RAISE EXCEPTION 'Buyer profile not found';
  END IF;

  SELECT COALESCE(NULLIF(ss.value, '')::numeric, 0)
  INTO _platform_fee_pct
  FROM system_settings ss
  WHERE ss.key = 'platform_fee_percent';
  _platform_fee_pct := COALESCE(_platform_fee_pct, 0);

  SELECT society_id INTO _buyer_society FROM profiles WHERE id = _buyer_id;
  SELECT latitude, longitude INTO _buyer_lat, _buyer_lon
  FROM societies WHERE id = _buyer_society;

  IF _has_urgent THEN
    _auto_cancel_at := now() + interval '3 minutes';
  END IF;

  FOR _group IN SELECT * FROM jsonb_array_elements(_seller_groups)
  LOOP
    _seller_id := (_group->>'seller_id')::uuid;
    _subtotal := (_group->>'subtotal')::numeric;
    _order_items := _group->'items';

    IF _cart_total > 0 AND _coupon_discount > 0 THEN
      _proportional_discount := ROUND((_subtotal / _cart_total) * _coupon_discount);
    ELSE
      _proportional_discount := 0;
    END IF;
    _final_amount := GREATEST(0, _subtotal - _proportional_discount);

    _platform_fee := ROUND(_final_amount * _platform_fee_pct / 100, 2);
    _net_amount := _final_amount - _platform_fee;

    SELECT sp.society_id INTO _seller_society
    FROM seller_profiles sp WHERE sp.id = _seller_id;

    _is_cross := (_buyer_society IS DISTINCT FROM _seller_society);

    IF _is_cross AND _buyer_lat IS NOT NULL AND _buyer_lon IS NOT NULL THEN
      SELECT s.latitude, s.longitude INTO _seller_lat, _seller_lon
      FROM societies s WHERE s.id = _seller_society;
      IF _seller_lat IS NOT NULL AND _seller_lon IS NOT NULL THEN
        _distance := public.haversine_km(_buyer_lat, _buyer_lon, _seller_lat, _seller_lon);
      END IF;
    END IF;

    _idempotency := gen_random_uuid()::text;

    -- DEFECT 1 FIX: Derive delivery_handled_by from seller's fulfillment_mode
    _delivery_handled_by := NULL;
    IF _fulfillment_type = 'delivery' THEN
      SELECT CASE
        WHEN sp.fulfillment_mode IN ('seller_delivery', 'pickup_and_seller_delivery') THEN 'seller'
        WHEN sp.fulfillment_mode IN ('platform_delivery', 'pickup_and_platform_delivery') THEN 'platform'
        ELSE 'seller'
      END INTO _delivery_handled_by
      FROM seller_profiles sp WHERE sp.id = _seller_id;
    END IF;

    INSERT INTO orders (
      buyer_id, seller_id, total_amount, coupon_id, discount_amount,
      payment_type, payment_status, delivery_address, notes,
      auto_cancel_at, idempotency_key,
      is_cross_society, buyer_society_id, seller_society_id, distance_km,
      fulfillment_type, delivery_fee, delivery_handled_by
    ) VALUES (
      _buyer_id, _seller_id, _final_amount + _delivery_fee, _coupon_id, _proportional_discount,
      _payment_method, _payment_status, _delivery_address, _notes,
      _auto_cancel_at, _idempotency,
      _is_cross, _buyer_society, _seller_society, _distance,
      _fulfillment_type, _delivery_fee, _delivery_handled_by
    )
    RETURNING id INTO _order_id;

    _order_ids := array_append(_order_ids, _order_id);
    _delivery_fee := 0;

    INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
    SELECT _order_id, (item->>'product_id')::uuid, item->>'product_name',
      (item->>'quantity')::integer, (item->>'unit_price')::numeric
    FROM jsonb_array_elements(_order_items) AS item;

    INSERT INTO payment_records (
      order_id, buyer_id, seller_id, amount,
      payment_method, payment_status, platform_fee, net_amount
    ) VALUES (
      _order_id, _buyer_id, _seller_id, _final_amount,
      _payment_method, _payment_status, _platform_fee, _net_amount
    );

    IF _first_order AND _coupon_id IS NOT NULL THEN
      INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_applied)
      VALUES (_coupon_id, _buyer_id, _order_id, _coupon_discount);
      _first_order := false;
    ELSE
      _first_order := false;
    END IF;
  END LOOP;

  DELETE FROM cart_items WHERE user_id = _buyer_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_ids', to_jsonb(_order_ids),
    'order_count', array_length(_order_ids, 1)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- DEFECT 2: Guard trg_auto_assign_delivery for platform-only deliveries
CREATE OR REPLACE FUNCTION public.trg_auto_assign_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  _buyer_society uuid;
  _idempotency text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status != 'ready' THEN RETURN NEW; END IF;
  IF NEW.fulfillment_type != 'delivery' THEN RETURN NEW; END IF;
  -- DEFECT 2 FIX: Only auto-assign for platform-handled deliveries
  IF COALESCE(NEW.delivery_handled_by, 'seller') != 'platform' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM delivery_assignments WHERE order_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT society_id INTO _buyer_society FROM profiles WHERE id = NEW.buyer_id;
  _idempotency := 'delivery_' || NEW.id::text || '_' || extract(epoch from now())::text;

  INSERT INTO delivery_assignments (order_id, society_id, delivery_fee, idempotency_key)
  VALUES (NEW.id, COALESCE(_buyer_society, NEW.buyer_society_id), NEW.delivery_fee, _idempotency);

  INSERT INTO notification_queue (user_id, title, body, type, reference_path, payload)
  SELECT sp.user_id,
    '🚚 Delivery Assignment Created',
    'A delivery partner is being assigned for order #' || LEFT(NEW.id::text, 8),
    'delivery', '/orders/' || NEW.id::text,
    jsonb_build_object('orderId', NEW.id, 'type', 'delivery_created')
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;

  RETURN NEW;
END;
$$;