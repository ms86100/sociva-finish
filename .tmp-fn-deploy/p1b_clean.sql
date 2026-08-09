-- Auto-refund: wallet destination when no razorpay payment id
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
  v_dest text := 'original_payment';
  v_payment_id text;
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

  v_refund_amount := public.compute_child_gateway_refund_amount(NEW.id);
  IF v_refund_amount IS NULL OR v_refund_amount <= 0 THEN
    RETURN NEW;
  END IF;

  v_payment_id := NULLIF(NEW.razorpay_payment_id, '');
  IF v_payment_id IS NULL AND NEW.checkout_group_id IS NOT NULL THEN
    SELECT NULLIF(cg.razorpay_payment_id, '') INTO v_payment_id
    FROM public.checkout_groups cg
    WHERE cg.id = NEW.checkout_group_id;
  END IF;

  IF v_payment_id IS NULL THEN
    v_dest := 'wallet';
  END IF;

  INSERT INTO public.refund_requests (
    order_id, buyer_id, seller_id, society_id, amount, reason, category,
    status, refund_state, auto_approved, approved_at, refund_destination,
    wallet_credit_amount
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
    'approved',
    true,
    now(),
    v_dest,
    CASE WHEN v_dest = 'wallet' THEN v_refund_amount ELSE 0 END
  );

  NEW.payment_status := 'refund_initiated';
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- seller_advance_order: FOR UPDATE + raise if 0 rows + return status
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.seller_advance_order(uuid, order_status, text);

CREATE OR REPLACE FUNCTION public.seller_advance_order(
  _order_id uuid,
  _new_status order_status,
  _rejection_reason text DEFAULT NULL::text
)
RETURNS order_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent_group TEXT;
  v_transaction_type TEXT;
  v_listing_type TEXT;
  v_valid BOOLEAN;
  v_updated_id uuid;
  v_final_status order_status;
BEGIN
  SELECT o.id, o.status, o.seller_id, o.fulfillment_type, o.delivery_handled_by,
         o.order_type, o.payment_type, o.payment_status, o.transaction_type,
         sp.primary_group, sp.user_id AS seller_user_id
  INTO v_order
  FROM orders o LEFT JOIN seller_profiles sp ON sp.id = o.seller_id
  WHERE o.id = _order_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.seller_user_id IS NULL OR v_order.seller_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_parent_group := resolve_transition_parent_group(v_order.primary_group);

  IF v_order.transaction_type IS NOT NULL THEN
    v_transaction_type := v_order.transaction_type;
  ELSE
    SELECT p.listing_type INTO v_listing_type
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = _order_id LIMIT 1;

    IF v_listing_type = 'contact_only' THEN v_transaction_type := 'contact_enquiry';
    ELSIF v_order.order_type = 'enquiry' THEN
      IF v_parent_group IN ('education_learning','events') THEN v_transaction_type := 'service_booking';
      ELSE v_transaction_type := 'request_service'; END IF;
    ELSIF v_order.order_type = 'booking' THEN v_transaction_type := 'service_booking';
    ELSIF v_order.fulfillment_type = 'self_pickup' THEN v_transaction_type := 'self_fulfillment';
    ELSIF v_order.fulfillment_type IN ('delivery','seller_delivery') THEN v_transaction_type := 'seller_delivery';
    ELSE v_transaction_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM category_status_transitions
    WHERE from_status = v_order.status::text AND to_status = _new_status::text
      AND (allowed_actor = 'seller' OR position('seller' IN allowed_actor) > 0)
      AND ((parent_group = v_parent_group AND transaction_type = v_transaction_type)
        OR (parent_group = 'default' AND transaction_type = v_transaction_type))
  ) INTO v_valid;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid seller transition from % to %', v_order.status, _new_status;
  END IF;

  PERFORM set_config('app.acting_as', 'seller', true);

  UPDATE orders
  SET status = _new_status,
      rejection_reason = COALESCE(_rejection_reason, rejection_reason),
      failure_owner = CASE
        WHEN _new_status::text IN ('cancelled', 'rejected') THEN COALESCE(failure_owner, 'seller')
        ELSE failure_owner
      END,
      updated_at = now(),
      auto_cancel_at = NULL
  WHERE id = _order_id AND status = v_order.status
  RETURNING id, status INTO v_updated_id, v_final_status;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Order status changed concurrently — refresh and retry'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_final_status;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seller_advance_order(uuid, order_status, text) TO authenticated, service_role;

-- ------------------------------------------------------------
