-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auto_refund_on_seller_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_acting text;
  v_is_seller_cancel boolean := false;
  v_refund_amount numeric;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text NOT IN ('cancelled', 'rejected') THEN
    RETURN NEW;
  END IF;

  v_acting := nullif(current_setting('app.acting_as', true), '');

  IF COALESCE(NEW.failure_owner, '') IN ('seller', 'platform') THEN
    v_is_seller_cancel := true;
  ELSIF COALESCE(v_acting, '') = 'seller' THEN
    v_is_seller_cancel := true;
    IF NEW.failure_owner IS NULL THEN
      NEW.failure_owner := 'seller';
    END IF;
  END IF;

  IF NOT v_is_seller_cancel THEN
    RETURN NEW;
  END IF;

  -- Only refund money that was actually collected / confirmed
  IF NEW.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.refund_requests rr
    WHERE rr.order_id = NEW.id
      AND rr.status NOT IN ('rejected')
      AND COALESCE(rr.refund_state, '') NOT IN ('rejected')
  ) THEN
    RETURN NEW;
  END IF;

  -- Child share of shared Razorpay capture (partial); last child gets remainder
  v_refund_amount := public.compute_child_gateway_refund_amount(NEW.id);
  IF v_refund_amount IS NULL OR v_refund_amount <= 0 THEN
    -- Fully covered by loyalty/wallet with zero residual — wallet/loyalty reverse via cancel triggers
    RETURN NEW;
  END IF;

  INSERT INTO public.refund_requests (
    order_id, buyer_id, seller_id, society_id, amount, reason, category,
    status, refund_state, auto_approved, approved_at
  ) VALUES (
    NEW.id,
    NEW.buyer_id,
    NEW.seller_id,
    NEW.society_id,
    v_refund_amount,
    CASE
      WHEN NEW.status::text = 'rejected' THEN 'Order rejected by seller (partial store refund)'
      ELSE COALESCE(NEW.rejection_reason, 'Order cancelled by seller (partial store refund)')
    END,
    'seller_cancelled',
    'approved',
    'approved',  -- critical: refund-processor + cron gate on refund_state
    true,
    now()
  );

  NEW.payment_status := 'refund_initiated';
  RETURN NEW;
END;
$function$;

