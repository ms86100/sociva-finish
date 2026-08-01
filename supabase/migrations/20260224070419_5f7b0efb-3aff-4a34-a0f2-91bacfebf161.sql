
-- =============================================
-- 1. seller_settlements table
-- =============================================
CREATE TABLE public.seller_settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  seller_id uuid NOT NULL REFERENCES public.seller_profiles(id),
  society_id uuid NOT NULL REFERENCES public.societies(id),
  gross_amount numeric NOT NULL DEFAULT 0,
  platform_fee numeric NOT NULL DEFAULT 0,
  delivery_fee_share numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  settlement_status text NOT NULL DEFAULT 'pending',
  eligible_at timestamptz,
  settled_at timestamptz,
  hold_reason text,
  razorpay_transfer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT uq_seller_settlements_order UNIQUE (order_id)
);

-- Enable RLS
ALTER TABLE public.seller_settlements ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 2. Indexes
-- =============================================
CREATE INDEX idx_seller_settlements_seller_id ON public.seller_settlements (seller_id);
CREATE INDEX idx_seller_settlements_society_id ON public.seller_settlements (society_id);
CREATE INDEX idx_seller_settlements_status ON public.seller_settlements (settlement_status);
CREATE INDEX idx_seller_settlements_eligible ON public.seller_settlements (settlement_status, eligible_at)
  WHERE settlement_status = 'eligible';

-- =============================================
-- 3. updated_at trigger
-- =============================================
CREATE TRIGGER set_seller_settlements_updated_at
  BEFORE UPDATE ON public.seller_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- =============================================
-- 4. Validation trigger: settlement_status
-- =============================================
CREATE OR REPLACE FUNCTION public.validate_settlement_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.settlement_status NOT IN ('pending', 'eligible', 'processing', 'settled', 'on_hold', 'disputed') THEN
    RAISE EXCEPTION 'Invalid settlement_status: %. Must be pending, eligible, processing, settled, on_hold, or disputed', NEW.settlement_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_settlement_status
  BEFORE INSERT OR UPDATE ON public.seller_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_settlement_status();

-- =============================================
-- 5. Guard trigger: prevent settling without delivery+payment
-- =============================================
CREATE OR REPLACE FUNCTION public.validate_settlement_release()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _delivery_status text;
  _payment_status text;
BEGIN
  -- Only enforce when moving TO 'settled' or 'processing'
  IF NEW.settlement_status NOT IN ('settled', 'processing') THEN
    RETURN NEW;
  END IF;
  IF OLD.settlement_status = NEW.settlement_status THEN
    RETURN NEW;
  END IF;

  -- Check delivery is confirmed
  SELECT status INTO _delivery_status
  FROM delivery_assignments WHERE order_id = NEW.order_id;

  IF _delivery_status IS NULL OR _delivery_status != 'delivered' THEN
    RAISE EXCEPTION 'Cannot settle: delivery not confirmed for order %', NEW.order_id;
  END IF;

  -- Check payment is confirmed
  SELECT payment_status INTO _payment_status
  FROM payment_records WHERE order_id = NEW.order_id LIMIT 1;

  IF _payment_status IS NULL OR _payment_status != 'paid' THEN
    RAISE EXCEPTION 'Cannot settle: payment not confirmed for order %', NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_settlement_release
  BEFORE UPDATE ON public.seller_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_settlement_release();

-- =============================================
-- 6. Auto-create settlement on order delivered/completed
-- =============================================
CREATE OR REPLACE FUNCTION public.trg_create_settlement_on_delivery()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _cooldown_hours integer;
  _platform_fee numeric;
  _gross numeric;
  _net numeric;
  _society_id uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('delivered', 'completed') THEN RETURN NEW; END IF;

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
$$;

CREATE TRIGGER trg_create_settlement_on_delivery
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_create_settlement_on_delivery();

-- =============================================
-- 7. RLS Policies
-- =============================================

-- Sellers can view their own settlements
CREATE POLICY "Sellers can view own settlements"
  ON public.seller_settlements FOR SELECT
  USING (
    seller_id IN (SELECT id FROM seller_profiles WHERE user_id = auth.uid())
  );

-- Society admins can view settlements in their society
CREATE POLICY "Society admins can view society settlements"
  ON public.seller_settlements FOR SELECT
  USING (
    public.is_society_admin(auth.uid(), society_id)
  );

-- Platform admins can view all
CREATE POLICY "Platform admins can view all settlements"
  ON public.seller_settlements FOR SELECT
  USING (
    public.is_admin(auth.uid())
  );

-- No direct INSERT/UPDATE/DELETE from client (triggers & edge functions only)
-- Platform admins can update via edge function using service role

-- =============================================
-- 8. transaction_audit_trail view
-- =============================================
CREATE OR REPLACE VIEW public.transaction_audit_trail AS
SELECT
  o.id AS order_id,
  o.created_at AS order_placed_at,
  o.status AS order_status,
  o.total_amount,
  o.discount_amount,
  o.delivery_fee,
  o.fulfillment_type,
  o.payment_status,
  o.razorpay_order_id,
  o.razorpay_payment_id,

  bp.name AS buyer_name,
  bp.flat_number AS buyer_flat,

  sp.business_name AS seller_name,
  sp.id AS seller_id,

  (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
  (SELECT sum(oi.quantity * oi.unit_price) FROM order_items oi WHERE oi.order_id = o.id) AS items_subtotal,

  pr.payment_mode,
  pr.payment_collection,
  pr.payment_status AS payment_record_status,
  pr.razorpay_payment_id AS payment_reference,
  pr.platform_fee,
  pr.created_at AS payment_initiated_at,

  da.status AS delivery_status,
  da.assigned_at AS delivery_assigned_at,
  da.pickup_at AS delivery_picked_up_at,
  da.at_gate_at AS delivery_at_gate_at,
  da.delivered_at AS delivery_completed_at,
  da.failure_owner,
  da.failed_reason,
  da.rider_name,
  da.otp_attempt_count,

  ss.settlement_status,
  ss.net_amount AS seller_payout,
  ss.eligible_at AS settlement_eligible_at,
  ss.settled_at AS settlement_paid_at,
  ss.hold_reason AS settlement_hold_reason

FROM orders o
LEFT JOIN profiles bp ON bp.id = o.buyer_id
LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
LEFT JOIN payment_records pr ON pr.order_id = o.id
LEFT JOIN delivery_assignments da ON da.order_id = o.id
LEFT JOIN seller_settlements ss ON ss.order_id = o.id;
