
-- ============================================================
-- 1. Insert canonical parent_group slugs into parent_groups
-- ============================================================
INSERT INTO public.parent_groups (slug, name, icon, color, sort_order, is_active, layout_type)
VALUES
  ('food_beverages', 'Food & Beverages', '🍲', 'bg-orange-100 text-orange-600', 1, true, 'ecommerce'),
  ('education_learning', 'Education & Learning', '📚', 'bg-blue-100 text-blue-600', 5, true, 'service'),
  ('home_services', 'Home Services', '🔧', 'bg-yellow-100 text-yellow-600', 6, true, 'service'),
  ('personal_care', 'Personal Care', '💅', 'bg-pink-100 text-pink-600', 7, true, 'service'),
  ('domestic_help', 'Domestic Help', '🏠', 'bg-teal-100 text-teal-600', 8, true, 'service')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 2. Remap seller_profiles (no FK constraint, safe to update)
-- ============================================================
UPDATE public.seller_profiles SET primary_group = 'food_beverages'      WHERE primary_group = 'food';
UPDATE public.seller_profiles SET primary_group = 'education_learning'  WHERE primary_group = 'classes';

-- ============================================================
-- 3. Fix buyer_advance_order — add resolve_transition_parent_group + prefer stored transaction_type
-- ============================================================
CREATE OR REPLACE FUNCTION public.buyer_advance_order(_order_id uuid, _new_status order_status)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_valid BOOLEAN;
  v_listing_type TEXT;
BEGIN
  SELECT o.id, o.status, o.buyer_id, o.fulfillment_type, o.delivery_handled_by, o.order_type,
         o.payment_type, o.payment_status, o.transaction_type,
         sp.primary_group
  INTO v_order
  FROM orders o
  LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized — you are not the buyer of this order';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := v_order.transaction_type;
  ELSE
    SELECT cc.transaction_type INTO v_listing_type
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN category_config cc ON cc.category::text = p.category
    WHERE oi.order_id = _order_id
    LIMIT 1;

    IF v_listing_type = 'contact_only' THEN
      v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning', 'events') THEN
        v_transaction_type := 'service_booking';
      ELSE
        v_transaction_type := 'request_service';
      END IF;
    ELSIF v_order.order_type = 'booking' THEN
      v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN
      v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type = 'seller_delivery' THEN
      v_transaction_type := 'seller_delivery';
    ELSIF v_order.fulfillment_type = 'delivery' AND (v_order.delivery_handled_by IS NULL OR v_order.delivery_handled_by = 'seller') THEN
      v_transaction_type := 'seller_delivery';
    ELSIF v_order.fulfillment_type = 'delivery' AND v_order.delivery_handled_by = 'platform' THEN
      v_transaction_type := 'cart_purchase';
    ELSE
      v_transaction_type := 'self_fulfillment';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text
      AND to_status = _new_status::text
      AND allowed_actor = 'buyer'
      AND (
        (parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type)
      )
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid buyer transition from % to %', v_order.status, _new_status;
  END IF;

  PERFORM set_config('app.acting_as', 'buyer', true);

  IF _new_status::text = 'completed' AND v_order.payment_type = 'cod' AND COALESCE(v_order.payment_status, 'pending') <> 'paid' THEN
    UPDATE orders
    SET status = _new_status,
        payment_status = 'paid',
        payment_confirmed_at = now(),
        buyer_confirmed_at = now(),
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  ELSE
    UPDATE orders
    SET status = _new_status,
        buyer_confirmed_at = CASE WHEN _new_status::text = 'completed' THEN now() ELSE buyer_confirmed_at END,
        updated_at = now(),
        auto_cancel_at = NULL
    WHERE id = _order_id
      AND status = v_order.status;
  END IF;
END;
$$;

-- ============================================================
-- 4. Fix generate_generic_otp — correct column names and signature
-- ============================================================
DROP FUNCTION IF EXISTS public.generate_generic_otp(uuid, text);

CREATE OR REPLACE FUNCTION public.generate_generic_otp(_order_id uuid, _target_status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _code text;
BEGIN
  _code := lpad(floor(random() * 10000)::text, 4, '0');
  INSERT INTO order_otp_codes (order_id, target_status, otp_code, expires_at)
  VALUES (_order_id, _target_status, _code, now() + interval '30 minutes');
  RETURN _code;
END;
$$;

-- ============================================================
-- 5. Remove duplicate triggers
-- ============================================================
DROP TRIGGER IF EXISTS enforce_otp_gate ON public.orders;
DROP TRIGGER IF EXISTS trg_restore_stock_on_order_cancel ON public.orders;
