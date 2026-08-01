-- Prevent direct transition to 'delivered' on delivery_assignments
-- Only the verify_delivery_otp_and_complete RPC (which sets app.otp_verified) may do this
CREATE OR REPLACE FUNCTION public.enforce_delivery_assignment_otp_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only guard transitions TO 'delivered'
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') THEN
    -- Allow if OTP was verified in this transaction
    IF current_setting('app.otp_verified', true) = 'true' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Delivery OTP verification required. Use the verify_delivery_otp_and_complete function.';
  END IF;
  RETURN NEW;
END;
$$;

-- Drop if exists to avoid duplicate
DROP TRIGGER IF EXISTS trg_enforce_delivery_assignment_otp ON public.delivery_assignments;

CREATE TRIGGER trg_enforce_delivery_assignment_otp
  BEFORE UPDATE ON public.delivery_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_delivery_assignment_otp_gate();