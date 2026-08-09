CREATE OR REPLACE FUNCTION public.request_refund(
  p_order_id uuid,
  p_reason text,
  p_category text DEFAULT 'order_issue'::text,
  p_evidence_urls text[] DEFAULT NULL::text[],
  p_refund_destination text DEFAULT 'original_payment'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_refund_id uuid;
  v_seller_user uuid;
  v_dest text;
  v_valid_categories text[] := ARRAY[
    'order_issue','quality_issue','wrong_item','not_received','seller_cancelled','other'
  ];
BEGIN
  IF p_category IS NULL OR NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid refund category: %', COALESCE(p_category, 'NULL');
  END IF;

  v_dest := lower(COALESCE(NULLIF(trim(p_refund_destination), ''), 'original_payment'));
  IF v_dest NOT IN ('original_payment', 'wallet') THEN
    RAISE EXCEPTION 'Invalid refund destination: %', v_dest;
  END IF;

  SELECT id, buyer_id, seller_id, society_id, total_amount, frozen_total, payment_status, status,
         payment_type, wallet_cash_amount, wallet_promo_amount
  INTO v_order
  FROM orders
  WHERE id = p_order_id AND buyer_id = auth.uid();

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or does not belong to you';
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'buyer_confirmed', 'seller_verified', 'completed') THEN
    RAISE EXCEPTION 'No payment found for this order';
  END IF;

  IF EXISTS (SELECT 1 FROM refund_requests WHERE order_id = p_order_id AND status NOT IN ('rejected', 'completed')) THEN
    RAISE EXCEPTION 'A refund request already exists for this order';
  END IF;

  -- COD / wallet-only: prefer wallet credit when destination not forced to original
  IF v_dest = 'original_payment'
     AND lower(COALESCE(v_order.payment_type, '')) IN ('cod', 'cash') THEN
    v_dest := 'wallet';
  END IF;

  -- Refundable = residual paid (gateway/COD) + wallet applied on this order
  -- (frozen_total wins when set; else reconstruct buyer economic outlay)
  INSERT INTO refund_requests (
    order_id, buyer_id, seller_id, society_id, amount, reason, category,
    evidence_urls, refund_method, refund_destination, wallet_credit_amount
  )
  VALUES (
    p_order_id,
    v_order.buyer_id,
    v_order.seller_id,
    v_order.society_id,
    COALESCE(
      NULLIF(v_order.frozen_total, 0),
      COALESCE(v_order.total_amount, 0)
        + COALESCE(v_order.wallet_cash_amount, 0)
        + COALESCE(v_order.wallet_promo_amount, 0)
    ),
    p_reason,
    p_category,
    p_evidence_urls,
    CASE WHEN v_dest = 'wallet' THEN 'wallet' ELSE 'original_payment' END,
    v_dest,
    CASE WHEN v_dest = 'wallet' THEN COALESCE(
      NULLIF(v_order.frozen_total, 0),
      COALESCE(v_order.total_amount, 0)
        + COALESCE(v_order.wallet_cash_amount, 0)
        + COALESCE(v_order.wallet_promo_amount, 0)
    ) ELSE NULL END
  )
  RETURNING id INTO v_refund_id;

  IF NOT EXISTS (SELECT 1 FROM dispute_tickets WHERE order_id = p_order_id AND status != 'resolved') THEN
    INSERT INTO dispute_tickets (order_id, raised_by, against_user, reason, category, status, society_id)
    VALUES (p_order_id, auth.uid(), v_order.seller_id, p_reason, p_category, 'open', v_order.society_id);
  END IF;

  SELECT sp.user_id INTO v_seller_user
  FROM seller_profiles sp
  WHERE sp.id = v_order.seller_id;

  IF v_seller_user IS NOT NULL THEN
    INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, payload)
    VALUES (
      v_seller_user,
      'Refund requested',
      'A buyer requested a refund. Reason: ' || left(coalesce(p_reason, ''), 120),
      'order',
      '/orders/' || p_order_id,
      jsonb_build_object(
        'orderId', p_order_id,
        'refundId', v_refund_id,
        'status', 'refund_requested',
        'target_role', 'seller',
        'wa_template', 'sociva_refund_update',
        'refund_destination', v_dest
      )
    );
  END IF;

  RETURN v_refund_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_refund(uuid, text, text, text[], text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- complete_refund: loyalty clawback + wallet restore + optional wallet credit msg
-- ------------------------------------------------------------
