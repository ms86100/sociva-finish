
-- Gap 1: Create 4-digit numeric delivery code trigger
CREATE OR REPLACE FUNCTION public.generate_delivery_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when transitioning to ready or picked_up
  IF NEW.status IN ('ready', 'picked_up') AND (OLD.status IS NULL OR OLD.status NOT IN ('ready', 'picked_up')) THEN
    UPDATE delivery_assignments
    SET delivery_code = LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0')
    WHERE order_id = NEW.id
      AND delivery_code IS NULL
      AND status NOT IN ('delivered', 'completed', 'cancelled', 'failed');
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on orders table
DROP TRIGGER IF EXISTS trg_generate_delivery_code ON public.orders;
CREATE TRIGGER trg_generate_delivery_code
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_delivery_code();

-- Backfill existing active assignments
UPDATE public.delivery_assignments
SET delivery_code = LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0')
WHERE delivery_code IS NULL
  AND status NOT IN ('delivered', 'completed', 'cancelled', 'failed');

-- Gap 3: Validation trigger to prevent direct status='delivered' bypass
CREATE OR REPLACE FUNCTION public.enforce_delivery_otp_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_delivery_code BOOLEAN;
BEGIN
  -- Only check when transitioning TO 'delivered'
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    -- Check if a delivery assignment with a non-null code exists
    SELECT EXISTS (
      SELECT 1 FROM public.delivery_assignments
      WHERE order_id = NEW.id
        AND delivery_code IS NOT NULL
        AND status NOT IN ('cancelled', 'failed')
    ) INTO has_delivery_code;

    -- If there's a delivery code, the update MUST come through the RPC
    -- (which sets a config param as a marker)
    IF has_delivery_code THEN
      IF current_setting('app.otp_verified', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Delivery OTP verification required. Use the verify_delivery_otp_and_complete function.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_delivery_otp ON public.orders;
CREATE TRIGGER trg_enforce_delivery_otp
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_delivery_otp_gate();
