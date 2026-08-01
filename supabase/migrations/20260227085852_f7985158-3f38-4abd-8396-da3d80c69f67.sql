
-- DEFECT 1: Backfill delivery_handled_by on existing orders
UPDATE orders
SET delivery_handled_by = CASE
  WHEN fulfillment_type = 'delivery' THEN
    COALESCE(
      (SELECT CASE
        WHEN sp.fulfillment_mode IN ('seller_delivery','pickup_and_seller_delivery') THEN 'seller'
        ELSE 'platform'
      END FROM seller_profiles sp WHERE sp.id = orders.seller_id),
      'seller'
    )
  ELSE NULL
END
WHERE delivery_handled_by IS NULL
  AND status NOT IN ('cancelled');

-- DEFECT 2: Fix validate_settlement_release to handle self-pickup/seller-delivery
CREATE OR REPLACE FUNCTION validate_settlement_release()
RETURNS TRIGGER AS $$
DECLARE
  _delivery_status text;
  _payment_status text;
  _fulfillment_type text;
  _delivery_handled_by text;
BEGIN
  -- Only enforce when moving TO 'settled' or 'processing'
  IF NEW.settlement_status NOT IN ('settled', 'processing') THEN
    RETURN NEW;
  END IF;
  IF OLD.settlement_status = NEW.settlement_status THEN
    RETURN NEW;
  END IF;

  -- Look up order details
  SELECT fulfillment_type, delivery_handled_by
  INTO _fulfillment_type, _delivery_handled_by
  FROM orders WHERE id = NEW.order_id;

  -- Check delivery is confirmed (only for platform-delivery orders)
  IF _fulfillment_type = 'delivery' AND _delivery_handled_by = 'platform' THEN
    SELECT status INTO _delivery_status
    FROM delivery_assignments WHERE order_id = NEW.order_id;

    IF _delivery_status IS NULL OR _delivery_status != 'delivered' THEN
      RAISE EXCEPTION 'Cannot settle: delivery not confirmed for order %', NEW.order_id;
    END IF;
  ELSE
    -- For self-pickup or seller-delivery, verify order is completed/delivered
    IF NOT EXISTS (
      SELECT 1 FROM orders
      WHERE id = NEW.order_id AND status IN ('delivered', 'completed')
    ) THEN
      RAISE EXCEPTION 'Cannot settle: order not completed for order %', NEW.order_id;
    END IF;
  END IF;

  -- Check payment is confirmed
  SELECT payment_status INTO _payment_status
  FROM payment_records WHERE order_id = NEW.order_id LIMIT 1;

  IF _payment_status IS NULL OR _payment_status != 'paid' THEN
    RAISE EXCEPTION 'Cannot settle: payment not confirmed for order %', NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DEFECT 3: Auto-confirm COD payments when order reaches delivered/completed
CREATE OR REPLACE FUNCTION trg_create_settlement_on_delivery()
RETURNS TRIGGER AS $$
DECLARE
  _cooldown_hours integer;
  _platform_fee numeric;
  _gross numeric;
  _net numeric;
  _society_id uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('delivered', 'completed') THEN RETURN NEW; END IF;

  -- Auto-confirm COD payment when order is delivered/completed
  UPDATE payment_records
  SET payment_status = 'paid', updated_at = now()
  WHERE order_id = NEW.id
    AND payment_type = 'cod'
    AND payment_status != 'paid';

  -- Skip if settlement already exists
  IF EXISTS (SELECT 1 FROM seller_settlements WHERE order_id = NEW.id) THEN RETURN NEW; END IF;

  -- Get cooldown from system_settings (default 48h)
  SELECT COALESCE(value::integer, 48) INTO _cooldown_hours
  FROM system_settings WHERE key = 'settlement_cooldown_hours';
  IF _cooldown_hours IS NULL THEN _cooldown_hours := 48; END IF;

  -- Get platform fee from payment_records
  SELECT COALESCE(pr.platform_fee, 0) INTO _platform_fee
  FROM payment_records pr WHERE pr.order_id = NEW.id LIMIT 1;
  IF _platform_fee IS NULL THEN _platform_fee := 0; END IF;

  _gross := COALESCE(NEW.total_amount, 0);
  _net := _gross - _platform_fee;

  -- Get society_id
  SELECT society_id INTO _society_id FROM profiles WHERE id = NEW.buyer_id;

  INSERT INTO seller_settlements (
    order_id, seller_id, society_id,
    gross_amount, platform_fee, delivery_fee_share, net_amount,
    settlement_status, eligible_at
  ) VALUES (
    NEW.id, NEW.seller_id, COALESCE(_society_id, NEW.buyer_society_id),
    _gross, _platform_fee, COALESCE(NEW.delivery_fee, 0), _net,
    'pending',
    now() + (_cooldown_hours || ' hours')::interval
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DEFECT 6: Clean up spurious delivery_assignments for non-platform-delivery orders
DELETE FROM delivery_assignments
WHERE order_id IN (
  SELECT id FROM orders
  WHERE COALESCE(delivery_handled_by, 'seller') != 'platform'
);
