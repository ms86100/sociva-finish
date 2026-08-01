-- Phase 3b: Status honesty — split unpaid checkout vs COD mid-flow cash confirm
-- payment_pending  = unpaid online checkout hold only
-- awaiting_cod_confirmation = COD mid-flow (after delivery / buyer_received)
--
-- Data map:
--   COD orders currently in payment_pending → awaiting_cod_confirmation
--   Online unpaid payment_pending → unchanged

-- ── Flows: rename mid-flow payment_pending → awaiting_cod_confirmation ────────
-- Mid-flow rows sit after delivery / buyer_received (sort_order >= 45).
UPDATE public.category_status_flows
SET status_key = 'awaiting_cod_confirmation',
    display_label = 'Confirm Cash Payment',
    buyer_display_label = COALESCE(buyer_display_label, 'Waiting for cash confirmation'),
    seller_display_label = COALESCE(seller_display_label, 'Confirm cash received'),
    buyer_hint = 'Seller will confirm once cash is received.',
    seller_hint = 'Confirm cash payment to complete the order.',
    color = 'bg-amber-100 text-amber-800',
    icon = COALESCE(NULLIF(icon, ''), 'Banknote')
WHERE status_key = 'payment_pending'
  AND sort_order >= 45;

-- Checkout hold rows (if any early sort) keep payment_pending but honest labels
UPDATE public.category_status_flows
SET display_label = 'Complete Payment',
    buyer_display_label = 'Complete payment',
    seller_display_label = 'Awaiting buyer payment',
    buyer_hint = 'Complete UPI or online payment to place this order.',
    seller_hint = 'Buyer has not completed payment yet.'
WHERE status_key = 'payment_pending'
  AND sort_order < 45;

-- Ensure mid-flow flow rows exist for workflows that had transitions but missing labels
INSERT INTO public.category_status_flows (
  parent_group, transaction_type, status_key, sort_order, actor,
  is_terminal, is_success, display_label, color, icon,
  buyer_hint, seller_hint, buyer_display_label, seller_display_label
)
SELECT DISTINCT
  t.parent_group,
  t.transaction_type,
  'awaiting_cod_confirmation',
  CASE
    WHEN t.transaction_type = 'self_fulfillment' THEN 48
    ELSE 85
  END,
  'seller',
  false,
  false,
  'Confirm Cash Payment',
  'bg-amber-100 text-amber-800',
  'Banknote',
  'Seller will confirm once cash is received.',
  'Confirm cash payment to complete the order.',
  'Waiting for cash confirmation',
  'Confirm cash received'
FROM public.category_status_transitions t
WHERE (t.from_status = 'payment_pending' OR t.to_status = 'payment_pending')
  AND t.transaction_type IN ('self_fulfillment', 'seller_delivery', 'cart_purchase')
  AND NOT EXISTS (
    SELECT 1 FROM public.category_status_flows f
    WHERE f.parent_group = t.parent_group
      AND f.transaction_type = t.transaction_type
      AND f.status_key = 'awaiting_cod_confirmation'
  );

-- ── Transitions: mid-flow payment_pending → awaiting_cod_confirmation ─────────
UPDATE public.category_status_transitions
SET to_status = 'awaiting_cod_confirmation'
WHERE to_status = 'payment_pending'
  AND from_status IN ('delivered', 'buyer_received');

UPDATE public.category_status_transitions
SET from_status = 'awaiting_cod_confirmation'
WHERE from_status = 'payment_pending'
  AND to_status = 'completed';

-- Seller may advance from awaiting_cod_confirmation after confirming cash (optional side path)
INSERT INTO public.category_status_transitions (
  parent_group, transaction_type, from_status, to_status, allowed_actor, auto_transition
)
SELECT DISTINCT
  f.parent_group, f.transaction_type,
  'awaiting_cod_confirmation', 'completed', 'seller', false
FROM public.category_status_flows f
WHERE f.status_key = 'awaiting_cod_confirmation'
  AND NOT EXISTS (
    SELECT 1 FROM public.category_status_transitions t
    WHERE t.parent_group = f.parent_group
      AND t.transaction_type = f.transaction_type
      AND t.from_status = 'awaiting_cod_confirmation'
      AND t.to_status = 'completed'
      AND t.allowed_actor = 'seller'
  );

-- ── Existing orders: COD mid-flow only ───────────────────────────────────────
UPDATE public.orders
SET status = 'awaiting_cod_confirmation'::order_status,
    updated_at = now()
WHERE status = 'payment_pending'::order_status
  AND COALESCE(payment_type, '') = 'cod';

-- ── Transition validator: allow RPC-managed awaiting_cod_confirmation exits ──
CREATE OR REPLACE FUNCTION public.validate_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _raw_pg TEXT;
  _parent_group TEXT;
  _txn_type TEXT;
  _valid BOOLEAN;
  _listing_type TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  -- Checkout unpaid hold is managed by payment RPCs (confirm / verify / auto-cancel)
  IF OLD.status::text = 'payment_pending' THEN RETURN NEW; END IF;
  IF current_setting('app.otp_verified', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.status::text = 'cancelled' AND current_setting('role', true) = 'service_role' THEN RETURN NEW; END IF;

  SELECT sp.primary_group INTO _raw_pg
  FROM public.seller_profiles sp WHERE sp.id = NEW.seller_id;

  _parent_group := resolve_transition_parent_group(_raw_pg);

  IF NEW.transaction_type IS NOT NULL THEN
    _txn_type := NEW.transaction_type;
  ELSE
    SELECT p.listing_type INTO _listing_type
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = NEW.id LIMIT 1;

    IF _listing_type = 'contact_only' THEN _txn_type := 'contact_enquiry';
    ELSIF NEW.order_type = 'enquiry' THEN
      IF _parent_group IN ('education_learning','events') THEN _txn_type := 'service_booking';
      ELSE _txn_type := 'request_service'; END IF;
    ELSIF NEW.order_type = 'booking' THEN _txn_type := 'service_booking';
    ELSIF NEW.fulfillment_type = 'self_pickup' THEN _txn_type := 'self_fulfillment';
    ELSIF NEW.fulfillment_type = 'seller_delivery' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND COALESCE(NEW.delivery_handled_by,'seller') = 'seller' THEN _txn_type := 'seller_delivery';
    ELSIF NEW.fulfillment_type = 'delivery' AND NEW.delivery_handled_by = 'platform' THEN _txn_type := 'cart_purchase';
    ELSE _txn_type := 'self_fulfillment'; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.category_status_transitions
    WHERE parent_group = _parent_group AND transaction_type = _txn_type
      AND from_status = OLD.status::text AND to_status = NEW.status::text
  ) INTO _valid;

  IF NOT _valid AND _parent_group != 'default' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.category_status_transitions
      WHERE parent_group = 'default' AND transaction_type = _txn_type
        AND from_status = OLD.status::text AND to_status = NEW.status::text
    ) INTO _valid;
  END IF;

  IF NOT _valid THEN
    RAISE EXCEPTION 'Invalid status transition from "%" to "%" (parent_group=%, txn_type=%)',
      OLD.status, NEW.status, _parent_group, _txn_type;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON COLUMN public.orders.status IS
  'Workflow status. payment_pending = unpaid online checkout hold. awaiting_cod_confirmation = COD mid-flow cash confirm. Do not conflate.';
