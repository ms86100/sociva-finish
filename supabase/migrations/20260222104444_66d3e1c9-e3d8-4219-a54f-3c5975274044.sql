
-- H1: Add price_amount and price_period to feature_packages
ALTER TABLE public.feature_packages 
  ADD COLUMN IF NOT EXISTS price_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS price_period text DEFAULT NULL;

-- H3: Fix create_multi_vendor_orders to read platform_fee_percent from system_settings
CREATE OR REPLACE FUNCTION public.create_multi_vendor_orders(
  _buyer_id uuid, _delivery_address text, _notes text DEFAULT NULL::text,
  _payment_method text DEFAULT 'cod'::text, _payment_status text DEFAULT 'pending'::text,
  _coupon_id uuid DEFAULT NULL::uuid, _coupon_code text DEFAULT NULL::text,
  _coupon_discount numeric DEFAULT 0, _cart_total numeric DEFAULT 0,
  _has_urgent boolean DEFAULT false, _seller_groups jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '15s'
AS $function$
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
  _fee_percent numeric;
  _platform_fee numeric;
  _net numeric;
BEGIN
  -- Validate buyer exists
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = _buyer_id) THEN
    RAISE EXCEPTION 'Buyer profile not found';
  END IF;

  -- Read platform fee from system_settings
  _fee_percent := COALESCE(
    (SELECT value::numeric FROM system_settings WHERE key = 'platform_fee_percent'),
    0
  );

  -- Get buyer society
  SELECT society_id INTO _buyer_society FROM profiles WHERE id = _buyer_id;

  -- Get buyer society coordinates
  SELECT latitude, longitude INTO _buyer_lat, _buyer_lon
  FROM societies WHERE id = _buyer_society;

  -- Set auto-cancel for urgent orders
  IF _has_urgent THEN
    _auto_cancel_at := now() + interval '3 minutes';
  END IF;

  -- Loop through each seller group
  FOR _group IN SELECT * FROM jsonb_array_elements(_seller_groups)
  LOOP
    _seller_id := (_group->>'seller_id')::uuid;
    _subtotal := (_group->>'subtotal')::numeric;
    _order_items := _group->'items';

    -- Calculate proportional coupon discount
    IF _cart_total > 0 AND _coupon_discount > 0 THEN
      _proportional_discount := ROUND((_subtotal / _cart_total) * _coupon_discount);
    ELSE
      _proportional_discount := 0;
    END IF;
    _final_amount := GREATEST(0, _subtotal - _proportional_discount);

    -- Calculate platform fee
    _platform_fee := ROUND(_final_amount * _fee_percent / 100, 2);
    _net := _final_amount - _platform_fee;

    -- Get seller society and compute distance
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

    -- Create order
    INSERT INTO orders (
      buyer_id, seller_id, total_amount, coupon_id, discount_amount,
      payment_type, payment_status, delivery_address, notes,
      auto_cancel_at, idempotency_key,
      is_cross_society, buyer_society_id, seller_society_id, distance_km
    ) VALUES (
      _buyer_id, _seller_id, _final_amount, _coupon_id, _proportional_discount,
      _payment_method, _payment_status, _delivery_address, _notes,
      _auto_cancel_at, _idempotency,
      _is_cross, _buyer_society, _seller_society, _distance
    )
    RETURNING id INTO _order_id;

    _order_ids := array_append(_order_ids, _order_id);

    -- Create order items
    INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price)
    SELECT
      _order_id,
      (item->>'product_id')::uuid,
      item->>'product_name',
      (item->>'quantity')::integer,
      (item->>'unit_price')::numeric
    FROM jsonb_array_elements(_order_items) AS item;

    -- Create payment record with computed platform fee
    INSERT INTO payment_records (
      order_id, buyer_id, seller_id, amount,
      payment_method, payment_status,
      platform_fee, net_amount
    ) VALUES (
      _order_id, _buyer_id, _seller_id, _final_amount,
      _payment_method, _payment_status,
      _platform_fee, _net
    );

    -- Record coupon redemption only for first order
    IF _first_order AND _coupon_id IS NOT NULL THEN
      INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_applied)
      VALUES (_coupon_id, _buyer_id, _order_id, _coupon_discount);
      _first_order := false;
    ELSE
      _first_order := false;
    END IF;
  END LOOP;

  -- Clear cart atomically
  DELETE FROM cart_items WHERE user_id = _buyer_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_ids', to_jsonb(_order_ids),
    'order_count', array_length(_order_ids, 1)
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;
