
-- =============================================
-- Hardening: Delivery & Payment Gaps
-- =============================================

-- 1. delivery_assignments: SLA timestamps + failure attribution + OTP lockout
ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS failure_owner text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS at_gate_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_otp_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS otp_attempt_count integer NOT NULL DEFAULT 0;

-- 2. payment_records: mode/collection + unique razorpay_payment_id
ALTER TABLE public.payment_records
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'cod',
  ADD COLUMN IF NOT EXISTS payment_collection text NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS razorpay_payment_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_records_razorpay_payment_id
  ON public.payment_records (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

-- 3. Validation trigger: failure_owner
CREATE OR REPLACE FUNCTION public.validate_failure_owner()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.failure_owner IS NOT NULL AND NEW.failure_owner NOT IN ('seller_fault', 'rider_fault', 'buyer_unavailable', 'guard_rejected') THEN
    RAISE EXCEPTION 'Invalid failure_owner: %. Must be seller_fault, rider_fault, buyer_unavailable, or guard_rejected', NEW.failure_owner;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_failure_owner ON public.delivery_assignments;
CREATE TRIGGER trg_validate_failure_owner
  BEFORE INSERT OR UPDATE ON public.delivery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_failure_owner();

-- 4. Validation trigger: payment_mode
CREATE OR REPLACE FUNCTION public.validate_payment_mode()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.payment_mode NOT IN ('cod', 'upi', 'card') THEN
    RAISE EXCEPTION 'Invalid payment_mode: %. Must be cod, upi, or card', NEW.payment_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_mode ON public.payment_records;
CREATE TRIGGER trg_validate_payment_mode
  BEFORE INSERT OR UPDATE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_mode();

-- 5. Validation trigger: payment_collection
CREATE OR REPLACE FUNCTION public.validate_payment_collection()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.payment_collection NOT IN ('online', 'doorstep') THEN
    RAISE EXCEPTION 'Invalid payment_collection: %. Must be online or doorstep', NEW.payment_collection;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_collection ON public.payment_records;
CREATE TRIGGER trg_validate_payment_collection
  BEFORE INSERT OR UPDATE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_collection();

-- 6. Freeze order amount after payment initiated
CREATE OR REPLACE FUNCTION public.freeze_order_amount_after_payment()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.razorpay_order_id IS NOT NULL
     AND OLD.total_amount IS DISTINCT FROM NEW.total_amount THEN
    RAISE EXCEPTION 'Cannot modify total_amount after payment has been initiated (razorpay_order_id is set)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_order_amount ON public.orders;
CREATE TRIGGER trg_freeze_order_amount
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.freeze_order_amount_after_payment();
