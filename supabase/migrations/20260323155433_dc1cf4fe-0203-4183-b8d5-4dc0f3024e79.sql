
-- Backfill transaction_type on orders where it's NULL
UPDATE public.orders
SET transaction_type = CASE
  WHEN fulfillment_type = 'delivery' AND delivery_handled_by = 'seller' THEN 'seller_delivery'
  WHEN fulfillment_type = 'delivery' AND delivery_handled_by = 'platform' THEN 'platform_delivery'
  WHEN fulfillment_type = 'delivery' THEN 'seller_delivery'
  WHEN fulfillment_type = 'pickup' THEN 'self_fulfillment'
  WHEN fulfillment_type = 'self' THEN 'self_fulfillment'
  ELSE 'self_fulfillment'
END
WHERE transaction_type IS NULL;

-- Update enforce_delivery_otp_gate to respect workflow requires_otp flag
CREATE OR REPLACE FUNCTION public.enforce_delivery_otp_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_delivery_code BOOLEAN;
  workflow_requires_otp BOOLEAN;
  v_parent_group TEXT;
  v_transaction_type TEXT;
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

    IF has_delivery_code THEN
      -- Resolve workflow context from the order
      v_transaction_type := NEW.transaction_type;

      -- Get parent_group from seller_profiles
      SELECT sp.primary_group INTO v_parent_group
      FROM public.seller_profiles sp
      WHERE sp.id = NEW.seller_id;

      -- Check workflow requires_otp for the 'delivered' step
      -- First try exact match, then default group, then assume true
      SELECT csf.requires_otp INTO workflow_requires_otp
      FROM public.category_status_flows csf
      WHERE csf.status_key = 'delivered'
        AND csf.transaction_type = COALESCE(v_transaction_type, 'seller_delivery')
        AND csf.parent_group = COALESCE(v_parent_group, 'default')
      LIMIT 1;

      -- Fallback to default group if no match
      IF workflow_requires_otp IS NULL THEN
        SELECT csf.requires_otp INTO workflow_requires_otp
        FROM public.category_status_flows csf
        WHERE csf.status_key = 'delivered'
          AND csf.transaction_type = COALESCE(v_transaction_type, 'seller_delivery')
          AND csf.parent_group = 'default'
        LIMIT 1;
      END IF;

      -- Default to true if no workflow step found (safe default)
      IF workflow_requires_otp IS NULL THEN
        workflow_requires_otp := true;
      END IF;

      -- Only enforce OTP if the workflow requires it
      IF workflow_requires_otp THEN
        IF current_setting('app.otp_verified', true) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'Delivery OTP verification required. Use the verify_delivery_otp_and_complete function.';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
