
-- Fix 1: Restore workflow-driven delivery assignment trigger
CREATE OR REPLACE FUNCTION public.trg_create_seller_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _buyer_society uuid;
  _seller_society uuid;
  _resolved_society uuid;
  _idempotency text;
  _seller_user_id uuid;
  _seller_name text;
  _seller_phone text;
  _seller_lat numeric;
  _seller_lng numeric;
  _dest_lat numeric;
  _dest_lng numeric;
  _distance_m numeric;
  _initial_eta int;
  _delivery_code text;
  _is_tracking_step boolean;
  _parent_group text;
  _txn_type text;
BEGIN
  -- Skip if status hasn't changed
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  -- Only for delivery / seller_delivery fulfillment
  IF NEW.fulfillment_type NOT IN ('delivery', 'seller_delivery') THEN RETURN NEW; END IF;
  -- Skip platform-handled deliveries
  IF COALESCE(NEW.delivery_handled_by, 'seller') = 'platform' THEN RETURN NEW; END IF;
  -- Skip if assignment already exists
  IF EXISTS (SELECT 1 FROM delivery_assignments WHERE order_id = NEW.id) THEN RETURN NEW; END IF;

  -- Workflow-driven check: does this status have creates_tracking_assignment = true?
  SELECT sp.primary_group INTO _parent_group
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;
  _parent_group := COALESCE(_parent_group, 'default');
  _txn_type := COALESCE(NEW.transaction_type, 'seller_delivery');

  SELECT EXISTS (
    SELECT 1 FROM category_status_flows
    WHERE status_key = NEW.status::text
      AND creates_tracking_assignment = true
      AND parent_group = _parent_group
      AND transaction_type = _txn_type
  ) INTO _is_tracking_step;

  -- Fallback to default parent_group
  IF NOT _is_tracking_step THEN
    SELECT EXISTS (
      SELECT 1 FROM category_status_flows
      WHERE status_key = NEW.status::text
        AND creates_tracking_assignment = true
        AND parent_group = 'default'
        AND transaction_type = _txn_type
    ) INTO _is_tracking_step;
  END IF;

  IF NOT _is_tracking_step THEN RETURN NEW; END IF;

  -- Gather seller info
  SELECT sp.user_id, sp.business_name, sp.society_id, sp.latitude, sp.longitude, p.phone
  INTO _seller_user_id, _seller_name, _seller_society, _seller_lat, _seller_lng, _seller_phone
  FROM seller_profiles sp JOIN profiles p ON p.id = sp.user_id
  WHERE sp.id = NEW.seller_id;

  SELECT society_id INTO _buyer_society FROM profiles WHERE id = NEW.buyer_id;
  _resolved_society := COALESCE(_buyer_society, NEW.society_id, _seller_society);
  IF _resolved_society IS NULL THEN RETURN NEW; END IF;

  _idempotency := 'seller_delivery_' || NEW.id::text || '_' || extract(epoch from now())::text;
  _dest_lat := NEW.delivery_lat;
  _dest_lng := NEW.delivery_lng;
  _initial_eta := 15;

  IF _seller_lat IS NOT NULL AND _seller_lng IS NOT NULL AND _dest_lat IS NOT NULL AND _dest_lng IS NOT NULL THEN
    _distance_m := 6371000 * 2 * asin(sqrt(
      power(sin(radians((_dest_lat - _seller_lat) / 2)), 2) +
      cos(radians(_seller_lat)) * cos(radians(_dest_lat)) *
      power(sin(radians((_dest_lng - _seller_lng) / 2)), 2)
    ));
    _initial_eta := GREATEST(2, round((_distance_m * 1.3 / 1000.0 / 15.0) * 60));
  END IF;

  _delivery_code := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

  INSERT INTO delivery_assignments (
    order_id, society_id, delivery_fee, idempotency_key,
    rider_name, rider_phone, status,
    delivery_lat, delivery_lng, eta_minutes, delivery_code
  ) VALUES (
    NEW.id, _resolved_society, COALESCE(NEW.delivery_fee, 0), _idempotency,
    _seller_name, _seller_phone, NEW.status::text,
    _seller_lat, _seller_lng, _initial_eta, _delivery_code
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_create_seller_delivery_assignment failed for order %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Fix 2: Backfill missing delivery assignments for in-transit/delivered seller-delivery orders
INSERT INTO delivery_assignments (order_id, society_id, delivery_fee, idempotency_key, rider_name, rider_phone, status, delivery_code)
SELECT
  o.id,
  COALESCE(bp.society_id, o.society_id, sp.society_id),
  COALESCE(o.delivery_fee, 0),
  'backfill_' || o.id::text || '_' || extract(epoch from now())::text,
  sp.business_name,
  p.phone,
  o.status::text,
  LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0')
FROM orders o
JOIN seller_profiles sp ON sp.id = o.seller_id
JOIN profiles p ON p.id = sp.user_id
LEFT JOIN profiles bp ON bp.id = o.buyer_id
WHERE o.fulfillment_type IN ('delivery', 'seller_delivery')
  AND COALESCE(o.delivery_handled_by, 'seller') != 'platform'
  AND o.status::text IN ('picked_up', 'on_the_way', 'at_gate', 'delivered')
  AND NOT EXISTS (SELECT 1 FROM delivery_assignments da WHERE da.order_id = o.id)
ON CONFLICT DO NOTHING;

-- Fix 3: Fix OTP gate — fallback to generic OTP when delivery assignment missing
CREATE OR REPLACE FUNCTION public.enforce_otp_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _otp_type TEXT;
  _txn_type TEXT;
  _parent_group TEXT;
  _has_delivery_code BOOLEAN;
  _otp_verified BOOLEAN;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  IF current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT resolve_transition_parent_group(sp.primary_group) INTO _parent_group
  FROM seller_profiles sp WHERE sp.id = NEW.seller_id;
  _parent_group := COALESCE(_parent_group, 'default');
  _txn_type := COALESCE(NEW.transaction_type, 'self_fulfillment');

  SELECT csf.otp_type INTO _otp_type FROM category_status_flows csf
  WHERE csf.transaction_type = _txn_type AND csf.parent_group = _parent_group
    AND csf.status_key = NEW.status::text LIMIT 1;

  IF _otp_type IS NULL THEN
    SELECT csf.otp_type INTO _otp_type FROM category_status_flows csf
    WHERE csf.transaction_type = _txn_type AND csf.parent_group = 'default'
      AND csf.status_key = NEW.status::text LIMIT 1;
  END IF;

  IF _otp_type IS NULL OR _otp_type = '' THEN RETURN NEW; END IF;

  IF _otp_type = 'delivery' THEN
    -- Check if delivery assignment with code exists
    SELECT EXISTS (
      SELECT 1 FROM delivery_assignments WHERE order_id = NEW.id AND delivery_code IS NOT NULL
    ) INTO _has_delivery_code;

    IF _has_delivery_code THEN
      -- Delivery code exists — require delivery OTP verification via RPC
      RAISE EXCEPTION 'Delivery OTP verification required. Use verify_delivery_otp_and_complete RPC.';
    ELSE
      -- No delivery assignment — fall back to generic OTP check
      SELECT EXISTS (
        SELECT 1 FROM order_otp_codes
        WHERE order_id = NEW.id
          AND target_status = NEW.status::text
          AND verified = true
      ) INTO _otp_verified;

      IF NOT _otp_verified THEN
        RAISE EXCEPTION 'OTP verification required. Use verify_generic_otp_and_advance RPC.';
      END IF;
    END IF;
  END IF;

  IF _otp_type = 'generic' THEN
    SELECT EXISTS (
      SELECT 1 FROM order_otp_codes
      WHERE order_id = NEW.id
        AND target_status = NEW.status::text
        AND verified = true
    ) INTO _otp_verified;
    IF NOT _otp_verified THEN
      RAISE EXCEPTION 'OTP verification required. Use verify_generic_otp_and_advance RPC.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix 5: Fill missing picked_up step metadata for seller_delivery
UPDATE category_status_flows
SET
  display_label = 'Picked Up',
  color = 'bg-teal-100 text-teal-700',
  icon = 'PackageCheck',
  buyer_hint = 'Seller has picked up your order and is heading your way.'
WHERE parent_group = 'food_beverages'
  AND transaction_type = 'seller_delivery'
  AND status_key = 'picked_up'
  AND (display_label IS NULL OR display_label = '');
