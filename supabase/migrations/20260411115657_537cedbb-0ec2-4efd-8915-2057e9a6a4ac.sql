
-- Step 1: Expand dispute_tickets category constraint to include refund-originated categories
ALTER TABLE public.dispute_tickets
DROP CONSTRAINT IF EXISTS dispute_tickets_category_check;

ALTER TABLE public.dispute_tickets
ADD CONSTRAINT dispute_tickets_category_check
CHECK (category IN (
  'quality', 'delivery', 'payment', 'behaviour', 'other',
  'noise', 'parking', 'pet', 'maintenance',
  'order_issue', 'quality_issue', 'wrong_item', 'not_received', 'seller_cancelled', 'sla_breach'
));

-- Step 2: Recreate request_refund() with category validation
CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue',
  p_evidence_urls text[] DEFAULT NULL
)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  -- Validate category
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  -- Validate order belongs to caller
  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  -- Check payment was made
  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  -- Check no existing active refund
  IF EXISTS (SELECT 1 FROM refund_requests WHERE order_id = p_order_id AND status NOT IN ('rejected', 'completed')) THEN
    RAISE EXCEPTION 'A refund request already exists for this order';
  END IF;

  INSERT INTO refund_requests (order_id, buyer_id, seller_id, society_id, amount, reason, category, evidence_urls)
  VALUES (
    p_order_id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.society_id,
    COALESCE(v_order.frozen_total, v_order.total_amount),
    p_reason,
    p_category,
    p_evidence_urls
  )
  RETURNING id INTO v_refund_id;

  -- Auto-create dispute ticket using the same validated category
  IF NOT EXISTS (SELECT 1 FROM dispute_tickets WHERE order_id = p_order_id AND status != 'resolved') THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (p_order_id, auth.uid(), v_order.seller_id, p_reason, p_category, 'open', v_order.society_id);
  END IF;

  RETURN v_refund_id;
END;
$function$;
