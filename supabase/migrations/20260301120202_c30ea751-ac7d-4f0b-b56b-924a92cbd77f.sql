-- Fix 1: Cast NEW.status to text in fn_enqueue_new_order_notification
-- to resolve "operator does not exist: text = order_status" error

CREATE OR REPLACE FUNCTION public.fn_enqueue_new_order_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seller_user_id uuid;
  v_buyer_name text;
  v_exists boolean;
BEGIN
  IF NEW.status NOT IN ('placed', 'enquired') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.notification_queue
    WHERE (payload->>'orderId')::text = NEW.id::text
      AND (payload->>'status')::text = NEW.status::text
  ) INTO v_exists;

  IF v_exists THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_seller_user_id
  FROM public.seller_profiles
  WHERE id = NEW.seller_id;

  IF v_seller_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'A buyer') INTO v_buyer_name
  FROM public.profiles
  WHERE id = NEW.buyer_id;

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
  VALUES (
    v_seller_user_id,
    CASE WHEN NEW.status = 'placed' THEN 'New Order Received! 🛒'
         ELSE 'New Enquiry Received! 💬'
    END,
    v_buyer_name || CASE WHEN NEW.status = 'placed' THEN ' placed a new order'
                         ELSE ' sent an enquiry'
                    END,
    CASE WHEN NEW.status = 'placed' THEN 'order_placed'
         ELSE 'enquiry_received'
    END,
    '/orders/' || NEW.id,
    jsonb_build_object('orderId', NEW.id, 'status', NEW.status::text, 'buyerId', NEW.buyer_id)
  );

  RETURN NEW;
END;
$$;

-- Fix 2: Add self-order guard to create_multi_vendor_orders
-- Drop existing signature first
DROP FUNCTION IF EXISTS public.create_multi_vendor_orders(uuid,text,text,text,text,uuid,text,numeric,numeric,boolean,jsonb,text,numeric);

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
  _seller_user_id uuid;
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

    -- Self-order guard: prevent buying from your own store
    SELECT sp.user_id INTO _seller_user_id
    FROM seller_profiles sp WHERE sp.id = _seller_id;
    IF _seller_user_id = _buyer_id THEN
      RAISE EXCEPTION 'Cannot order from your own store';
    END IF;

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