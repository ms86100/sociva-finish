CREATE OR REPLACE FUNCTION public.fn_evaluate_support_resolution(p_order_id uuid, p_issue_type text, p_issue_subtype text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order record;
  v_rule record;
  v_resolved boolean := false;
  v_resolution_type text;
  v_resolution_note text;
  v_conditions jsonb;
  v_action_type text;
BEGIN
  SELECT id, status, payment_status, estimated_delivery_at, seller_id, buyer_id, society_id, total_amount
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('resolved', false, 'error', 'Order not found');
  END IF;

  FOR v_rule IN
    SELECT * FROM public.auto_resolution_rules
    WHERE issue_type = p_issue_type AND is_active = true
    ORDER BY priority DESC
  LOOP
    v_conditions := v_rule.condition_json;
    v_resolved := true;

    -- FIX: cast enum to text so jsonb_array_elements_text values compare correctly
    IF v_conditions ? 'order_status_in' THEN
      IF NOT (v_order.status::text = ANY(
        SELECT jsonb_array_elements_text(v_conditions->'order_status_in')
      )) THEN
        v_resolved := false;
      END IF;
    END IF;

    IF v_resolved AND v_conditions ? 'eta_breached_minutes' THEN
      IF v_order.estimated_delivery_at IS NOT NULL
         AND v_order.estimated_delivery_at >= (now() - ((v_conditions->>'eta_breached_minutes')::int * interval '1 minute')) THEN
        v_resolved := false;
      END IF;
    END IF;

    IF v_resolved AND v_conditions ? 'payment_status' THEN
      IF v_order.payment_status IS DISTINCT FROM (v_conditions->>'payment_status') THEN
        v_resolved := false;
      END IF;
    END IF;

    IF v_resolved THEN
      v_resolution_type := v_rule.action_json->>'type';
      v_resolution_note := v_rule.action_json->>'note';
      v_action_type := v_rule.action_json->>'type';

      IF v_action_type = 'cancel_and_refund' THEN
        UPDATE public.orders
        SET status = 'cancelled', updated_at = now()
        WHERE id = p_order_id
          AND status::text IN ('placed', 'preparing', 'pending');

        INSERT INTO public.refund_requests (order_id, buyer_id, seller_id, society_id, amount, reason, category, refund_method, status, auto_approved)
        VALUES (
          p_order_id,
          v_order.buyer_id,
          v_order.seller_id,
          v_order.society_id,
          v_order.total_amount,
          'Auto-resolved: ' || COALESCE(v_resolution_note, 'Order cancelled by support system'),
          'support_auto_resolution',
          'original_method',
          'approved',
          true
        )
        ON CONFLICT DO NOTHING;

      ELSIF v_action_type = 'refund' THEN
        INSERT INTO public.refund_requests (order_id, buyer_id, seller_id, society_id, amount, reason, category, refund_method, status, auto_approved)
        VALUES (
          p_order_id,
          v_order.buyer_id,
          v_order.seller_id,
          v_order.society_id,
          v_order.total_amount,
          'Auto-resolved: ' || COALESCE(v_resolution_note, 'Refund initiated by support system'),
          'support_auto_resolution',
          'original_method',
          'approved',
          true
        )
        ON CONFLICT DO NOTHING;
      END IF;

      EXIT;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'resolved', v_resolved,
    'resolution_type', v_resolution_type,
    'resolution_note', v_resolution_note,
    'order_status', v_order.status,
    'seller_id', v_order.seller_id,
    'buyer_id', v_order.buyer_id,
    'society_id', v_order.society_id
  );
END;
$function$;